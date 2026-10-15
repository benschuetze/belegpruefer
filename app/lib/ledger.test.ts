import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb, dbRefusal } from "../../tests/helpers/db";
import { NO_RESEARCH, team } from "../../tests/helpers/models";
import type { BookingLine, KontiererOutput } from "./agents/kontierer";
import { bookings, documents, reviews } from "./db/schema";
import { DEMO_TENANTS } from "./db/seed";
import { storeUpload } from "./documents.server";
import { bookingsInPeriod, confirmDocument, LedgerError, lockPeriod, reverseAndRebook } from "./ledger.server";
import { processDocument } from "./process.server";

const lines = (x: { satz: number; konto: string; buSchluessel: string }[]) => x as BookingLine[];

const A = DEMO_TENANTS[0].id;
const B = DEMO_TENANTS[1].id;
const TODAY = "2026-10-12";
const PAPER: KontiererOutput = {
  zeilen: lines([
    { satz: 19, konto: "4930", buSchluessel: "9" },
    { satz: 7, konto: "4940", buSchluessel: "8" },
  ]),
  konfidenz: 0.95,
  begruendung: "Papier und Fachbuch",
};

async function setup(kontierer: unknown = PAPER, pruefer: unknown = undefined, as: "app" | "owner" = "app") {
  const { db } = await createTestDb({ as });
  const stored = await storeUpload(
    db,
    A,
    "r.xml",
    readFileSync("app/lib/parser/__fixtures__/xrechnung-papierwerk.xml"),
  );
  if (stored.status !== "neu") throw new Error();
  await processDocument(db, A, stored.id, { models: team(kontierer, pruefer), research: NO_RESEARCH, today: TODAY });
  return { db, id: stored.id };
}

describe("Prüfen: bestätigen oder ändern", () => {
  it("„Passt, buchen“ übernimmt den Vorschlag, Review ok", async () => {
    const { db, id } = await setup(PAPER, { urteil: "einwand", begruendung: "unsicher" });
    await confirmDocument(db, A, id, PAPER.zeilen, "Demo", TODAY);
    const rows = await db.select().from(bookings);
    expect(rows.map((b) => [b.account, b.source])).toEqual([
      ["4930", "ki"],
      ["4940", "ki"],
    ]);
    const [review] = await db.select().from(reviews);
    expect(review?.result).toBe("ok");
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    expect(doc?.status).toBe("bestaetigt");
  });

  it("„Konto ändern“ bucht manuell und hält vorher und nachher fest", async () => {
    const { db, id } = await setup(PAPER, { urteil: "einwand", begruendung: "unsicher" });
    const changed = lines([
      { satz: 19, konto: "3400", buSchluessel: "9" },
      { satz: 7, konto: "4940", buSchluessel: "8" },
    ]);
    await confirmDocument(db, A, id, changed, "Demo", TODAY);
    expect((await db.select().from(bookings)).map((b) => b.source)).toEqual(["manuell", "manuell"]);
    const [review] = await db.select().from(reviews);
    expect(review?.result).toBe("korrigiert");
    expect(review?.before).toEqual([
      { konto: "4930", buSchluessel: "9" },
      { konto: "4940", buSchluessel: "8" },
    ]);
  });

  it("fehlt ein Steuersatz, wird nichts gebucht", async () => {
    const { db, id } = await setup(PAPER, { urteil: "einwand", begruendung: "x" });
    await expect(confirmDocument(db, A, id, PAPER.zeilen.slice(0, 1), "Demo", TODAY)).rejects.toThrow(LedgerError);
    expect(await db.select().from(bookings)).toEqual([]);
  });

  it("ein anderer Mandant kann den Beleg nicht bestätigen", async () => {
    const { db, id } = await setup(PAPER, { urteil: "einwand", begruendung: "x" });
    expect(await dbRefusal(confirmDocument(db, B, id, PAPER.zeilen, "Demo", TODAY))).toMatch(/nicht gefunden/);
  });
});

describe("Festschreiben und Storno", () => {
  it("festgeschriebene Buchungen kann die Datenbank weder ändern noch löschen", async () => {
    const { db } = await setup();
    await lockPeriod(db, A, "2026-09-01", "2026-09-30");
    // The runtime role may only set locked_at and delete unlocked bookings; for locked ones the trigger says no.
    expect(await dbRefusal(db.update(bookings).set({ lockedAt: null }))).toMatch(/festgeschrieben/);
    expect(await dbRefusal(db.delete(bookings))).toMatch(/festgeschrieben/);
  });

  it("festgeschriebene Buchungen bleiben auch für den Eigentümer der Tabellen endgültig", async () => {
    const { db } = await setup(PAPER, undefined, "owner");
    await lockPeriod(db, A, "2026-09-01", "2026-09-30");
    expect(await dbRefusal(db.update(bookings).set({ account: "4900" }))).toMatch(/festgeschrieben/);
  });

  it("ein Beleg behält Datei und Inhalt; festgeschrieben geht er nur per Storno zurück", async () => {
    const { db, id } = await setup(PAPER, undefined, "owner");
    expect(await dbRefusal(db.update(documents).set({ content: "eA==" }).where(eq(documents.id, id)))).toMatch(
      /unveränderbar/,
    );
    expect(
      await dbRefusal(
        db
          .update(documents)
          .set({ findings: [{ code: "x", severity: "hinweis", message: "nachträglich" }] })
          .where(eq(documents.id, id)),
      ),
    ).toMatch(/nur während der Verarbeitung/);
    await lockPeriod(db, A, "2026-09-01", "2026-09-30");
    expect(await dbRefusal(db.update(documents).set({ status: "neu" }).where(eq(documents.id, id)))).toMatch(
      /nur Storno/,
    );
    // The Storno path itself still works.
    await reverseAndRebook(db, A, id, PAPER.zeilen, "Demo", TODAY);
  });

  it("Festschreiben verweigert, solange im Zeitraum Belege offen sind", async () => {
    const { db } = await setup(PAPER, { urteil: "einwand", begruendung: "x" });
    expect(await dbRefusal(lockPeriod(db, A, "2026-09-01", "2026-09-30"))).toMatch(/noch offen/);
    // Other periods are not affected.
    await expect(lockPeriod(db, A, "2026-08-01", "2026-08-31")).resolves.toMatchObject({ total: 0 });
  });

  it("Korrektur nach Festschreiben: Storno mit Gegenbetrag plus neue Buchung, Summe stimmt", async () => {
    const { db, id } = await setup();
    await lockPeriod(db, A, "2026-09-01", "2026-09-30");
    const corrected = lines([
      { satz: 19, konto: "3400", buSchluessel: "9" },
      { satz: 7, konto: "4940", buSchluessel: "8" },
    ]);
    await reverseAndRebook(db, A, id, corrected, "Demo", TODAY);

    const rows = await db.select().from(bookings).where(eq(bookings.documentId, id));
    expect(rows).toHaveLength(6);
    const reversals = rows.filter((b) => b.reversalOf);
    expect(reversals.map((b) => b.amountCents).sort()).toEqual([-11864, -2996].sort());
    // Locked originals are untouched.
    expect(rows.filter((b) => b.lockedAt).map((b) => b.account)).toEqual(["4930", "4940"]);
    // Net effect: the invoice total once, on the corrected accounts.
    const total = rows.reduce((s, b) => s + b.amountCents, 0);
    expect(total).toBe(14860);
    const byAccount = Object.fromEntries(
      ["4930", "3400", "4940"].map((a) => [
        a,
        rows.filter((b) => b.account === a).reduce((s, b) => s + b.amountCents, 0),
      ]),
    );
    expect(byAccount).toEqual({ "4930": 0, "3400": 11864, "4940": 2996 });
  });

  it("Storno und neue Buchung landen im laufenden Zeitraum; der festgeschriebene bleibt, wie er exportiert wurde", async () => {
    const { db, id } = await setup();
    await lockPeriod(db, A, "2026-09-01", "2026-09-30");
    const september = await bookingsInPeriod(db, A, "2026-09-01", "2026-09-30");
    await reverseAndRebook(db, A, id, PAPER.zeilen, "Demo", TODAY);
    expect(await bookingsInPeriod(db, A, "2026-09-01", "2026-09-30")).toEqual(september);
    const october = await bookingsInPeriod(db, A, "2026-10-01", "2026-10-31");
    expect(october).toHaveLength(4);
    expect(october.every((b) => b.bookingDate === TODAY && !b.lockedAt)).toBe(true);
  });

  it("ein Beleg aus einem festgeschriebenen Monat wird im laufenden Monat gebucht", async () => {
    const { db } = await createTestDb();
    await lockPeriod(db, A, "2026-09-01", "2026-09-30");
    const stored = await storeUpload(
      db,
      A,
      "spaet.xml",
      readFileSync("app/lib/parser/__fixtures__/xrechnung-papierwerk.xml"),
    );
    if (stored.status !== "neu") throw new Error();
    await processDocument(db, A, stored.id, { models: team(PAPER), research: NO_RESEARCH, today: TODAY });
    const rows = await db.select().from(bookings).where(eq(bookings.documentId, stored.id));
    expect(rows.map((b) => b.bookingDate)).toEqual([TODAY, TODAY]);
  });

  it("Storno nur für festgeschriebene Belege", async () => {
    const { db, id } = await setup();
    expect(await dbRefusal(reverseAndRebook(db, A, id, PAPER.zeilen, "Demo", TODAY))).toMatch(/festgeschriebene/);
  });

  it("Reviews sind nur anhängend, selbst für den Eigentümer der Tabellen", async () => {
    const { db, id } = await setup(PAPER, { urteil: "einwand", begruendung: "x" }, "owner");
    await confirmDocument(db, A, id, PAPER.zeilen, "Demo", TODAY);
    expect(await dbRefusal(db.execute(sql`update reviews set user_label = 'x'`))).toMatch(/nur anhängend/);
    expect(await dbRefusal(db.execute(sql`delete from reviews`))).toMatch(/nur anhängend/);
  });
});
