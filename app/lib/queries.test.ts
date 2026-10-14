import { describe, expect, it } from "vitest";
import { makeBeleg } from "../../tests/helpers/belege";
import { createTestDb } from "../../tests/helpers/db";
import { DEMO_TENANTS } from "./db/seed";
import { storeUpload } from "./documents.server";
import { buildCiiXml } from "./parser/build-cii";
import { processDocument } from "./process.server";
import { listDocuments } from "./queries.server";

const A = DEMO_TENANTS[0].id;

describe("Belegliste", () => {
  it("ist nach Rechnungsdatum sortiert, neueste zuerst, nicht nach Upload-Reihenfolge", async () => {
    const { db } = await createTestDb();
    for (const [number, date] of [
      ["R-1", "2026-09-10"],
      ["R-2", "2026-09-28"],
      ["R-3", "2026-09-03"],
    ] as const) {
      const xml = buildCiiXml(makeBeleg(undefined, { invoiceNumber: number, issueDate: date }));
      const stored = await storeUpload(db, A, `${number}.xml`, Buffer.from(xml));
      if (stored.status !== "neu") throw new Error();
      await processDocument(db, A, stored.id, {
        models: null,
        research: { viesCheck: async () => ({ valid: null }), supplierHistory: async () => [] },
        today: "2026-10-12",
      });
    }
    const unreadable = await storeUpload(db, A, "kaputt.xml", Buffer.from("<Invoice/>"));
    expect(unreadable.status).toBe("neu");
    const rows = await listDocuments(db, A, "alle");
    expect(rows.map((r) => r.issueDate)).toEqual(["2026-09-28", "2026-09-10", "2026-09-03", null]);
  });
});
