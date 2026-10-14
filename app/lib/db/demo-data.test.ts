import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb, dbRefusal } from "../../../tests/helpers/db";
import { loadDemoData, markDemoDataLoaded, NotADemoDatabase, resetDemoDataIfOutdated } from "./demo-data";
import { bookings, decisions, documents, reviews, tenants } from "./schema";
import { DEMO_TENANTS } from "./seed";

describe("Demo-Daten", () => {
  it("laden alle Belege, zeigen jeden Weg und sind beim zweiten Mal unverändert", async () => {
    const { db } = await createTestDb();
    const created = await loadDemoData(db);
    expect(created).toBeGreaterThan(20);
    expect(await loadDemoData(db)).toBe(0);

    const rows = await db
      .select({ file: documents.filename, status: documents.status, tenant: documents.tenantId })
      .from(documents);
    const status = (file: string) => rows.find((r) => r.file === file)?.status;

    expect(status("halbmond-flyer.xml")).toBe("pruefen");
    expect(status("papierwerk-falsch.xml")).toBe("pruefen");
    expect(status("brandt-laptop.xml")).toBe("pruefen");
    expect(status("kranich-0912.xml")).toBe("pruefen");
    expect(status("clickwave-0998812.xml")).toBe("automatisch");
    expect(status("schutzbrief-2026.xml")).toBe("automatisch");
    expect(status("papierwerk-0731.xml")).toBe("festgeschrieben");
    // Both tenants have something to show.
    for (const tenant of DEMO_TENANTS) {
      expect(rows.filter((r) => r.tenant === tenant.id).length).toBeGreaterThan(5);
    }
    const locked = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, DEMO_TENANTS[0].id), eq(bookings.bookingDate, "2026-08-04")));
    expect(locked.every((b) => b.lockedAt)).toBe(true);
  });
});

describe("Demo-Daten neu laden", () => {
  // The reset is the build's job and runs as owner; the runtime role cannot switch triggers off (roles.test.ts).
  it("lädt bei neuer Version alles neu, sonst nichts; alle Schutz-Trigger sind danach wieder scharf", async () => {
    const { db } = await createTestDb({ as: "owner" });
    await loadDemoData(db);
    expect(await resetDemoDataIfOutdated(db)).toBe(true);
    expect(await db.$count(documents)).toBe(0);
    expect(await loadDemoData(db)).toBeGreaterThan(20);
    await markDemoDataLoaded(db);
    expect(await resetDemoDataIfOutdated(db)).toBe(false);
    expect(await db.$count(documents)).toBeGreaterThan(20);

    expect(await dbRefusal(db.execute(sql`update decisions set model = 'x'`))).toMatch(/nur anhängend/);
    expect(await dbRefusal(db.execute(sql`delete from decisions`))).toMatch(/nur anhängend/);
    expect(await dbRefusal(db.execute(sql`update reviews set user_label = 'x'`))).toMatch(/nur anhängend/);
    expect(await dbRefusal(db.execute(sql`truncate reviews`))).toMatch(/nur anhängend/);
    // August is festgeschrieben in the demo: still final after the reload.
    expect(await dbRefusal(db.execute(sql`update bookings set account = '4900' where locked_at is not null`))).toMatch(
      /festgeschrieben/,
    );
  });

  it("bricht ab und löscht nichts, sobald ein Mandant außerhalb der Demo existiert", async () => {
    const { db } = await createTestDb({ as: "owner" });
    await loadDemoData(db);
    const before = await db.$count(decisions);
    await db.insert(tenants).values({ name: "Echte GmbH", beraterNr: 1, mandantenNr: 2 });
    await expect(resetDemoDataIfOutdated(db)).rejects.toThrow(NotADemoDatabase);
    expect(await db.$count(decisions)).toBe(before);
  });

  it("bricht das Laden ab, bleibt die Version alt: der nächste Lauf setzt erneut zurück", async () => {
    const { db } = await createTestDb({ as: "owner" });
    expect(await resetDemoDataIfOutdated(db)).toBe(true);
    // No markDemoDataLoaded: loading never finished.
    expect(await resetDemoDataIfOutdated(db)).toBe(true);
  });
});

describe("Demo-Protokoll", () => {
  it("Festschreiben kommt nach der Korrektur, wie in echt", async () => {
    const { db } = await createTestDb();
    await loadDemoData(db);
    const [doc] = await db.select().from(documents).where(eq(documents.filename, "allerlei-08.xml"));
    if (!doc) throw new Error("allerlei-08 fehlt");
    const [review] = await db.select().from(reviews).where(eq(reviews.documentId, doc.id));
    const [booking] = await db.select().from(bookings).where(eq(bookings.documentId, doc.id));
    expect(review?.result).toBe("korrigiert");
    expect(booking?.lockedAt?.getTime()).toBeGreaterThanOrEqual(
      review?.createdAt.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });
});
