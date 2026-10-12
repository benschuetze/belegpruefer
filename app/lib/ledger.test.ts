import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../tests/helpers/db";
import { NO_RESEARCH, team } from "../../tests/helpers/models";
import type { BookingLine, KontiererOutput } from "./agents/kontierer";
import { bookings, documents, reviews } from "./db/schema";
import { DEMO_TENANTS } from "./db/seed";
import { storeUpload } from "./documents.server";
import { confirmDocument, LedgerError, lockPeriod, reverseAndRebook } from "./ledger.server";
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

async function setup(kontierer: unknown = PAPER, pruefer: unknown = undefined) {
  const { db } = await createTestDb();
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
    await expect(confirmDocument(db, B, id, PAPER.zeilen, "Demo", TODAY)).rejects.toThrow(/nicht gefunden/);
  });
});

describe("Festschreiben und Storno", () => {
  it("festgeschriebene Buchungen kann die Datenbank weder ändern noch löschen", async () => {
    const { db } = await setup();
    await lockPeriod(db, A, "2026-09-01", "2026-09-30");
    await expect(db.update(bookings).set({ account: "4900" })).rejects.toThrow();
    await expect(db.delete(bookings)).rejects.toThrow();
  });

  it("Festschreiben verweigert, solange im Zeitraum Belege offen sind", async () => {
    const { db } = await setup(PAPER, { urteil: "einwand", begruendung: "x" });
    await expect(lockPeriod(db, A, "2026-09-01", "2026-09-30")).rejects.toThrow(/noch offen/);
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

  it("Storno nur für festgeschriebene Belege", async () => {
    const { db, id } = await setup();
    await expect(reverseAndRebook(db, A, id, PAPER.zeilen, "Demo", TODAY)).rejects.toThrow(/festgeschriebene/);
  });

  it("Reviews sind nur anhängend", async () => {
    const { db, id } = await setup(PAPER, { urteil: "einwand", begruendung: "x" });
    await confirmDocument(db, A, id, PAPER.zeilen, "Demo", TODAY);
    await expect(db.execute(sql`update reviews set user_label = 'x'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from reviews`)).rejects.toThrow();
  });
});
