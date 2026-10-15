import { afterEach, describe, expect, it, vi } from "vitest";
import { makeBeleg } from "../../tests/helpers/belege";
import { createTestDb } from "../../tests/helpers/db";
import { DEMO_TENANTS } from "./db/seed";
import { storeUpload } from "./documents.server";
import { buildCiiXml } from "./parser/build-cii";
import { PARALLEL_DOCUMENTS } from "./process.server";
import { processQueue } from "./run.server";

const A = DEMO_TENANTS[0].id;
const B = DEMO_TENANTS[1].id;

afterEach(() => vi.unstubAllEnvs());

describe("Warteschlange abarbeiten", () => {
  it("nimmt je Runde höchstens drei Belege, bis nichts mehr wartet; der andere Mandant bleibt unberührt", async () => {
    vi.stubEnv("AI_MOCK", "1");
    const { db } = await createTestDb();
    for (let i = 0; i < 5; i++) {
      const xml = buildCiiXml(makeBeleg(undefined, { invoiceNumber: `Q-${i}` }));
      await storeUpload(db, A, `q${i}.xml`, Buffer.from(xml));
    }
    await storeUpload(db, B, "b.xml", Buffer.from(buildCiiXml(makeBeleg(undefined, { invoiceNumber: "B-1" }))));

    expect(await processQueue(db, A)).toEqual({ processed: PARALLEL_DOCUMENTS, waiting: 5 - PARALLEL_DOCUMENTS });
    expect(await processQueue(db, A)).toEqual({ processed: 2, waiting: 0 });
    expect(await processQueue(db, A)).toEqual({ processed: 0, waiting: 0 });
    expect((await processQueue(db, B)).processed).toBe(1);
  });
});
