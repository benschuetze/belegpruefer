import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../tests/helpers/db";
import { loadDemoData } from "./demo-data";
import { bookings, documents } from "./schema";
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
