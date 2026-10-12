import { getAgentModels } from "~/lib/agents/models";
import { viesCheckLive } from "~/lib/agents/recherche";
import { todayInGermany } from "~/lib/dates";
import type { Db } from "~/lib/db/client";
import { mapLimit, PARALLEL_DOCUMENTS, type ProcessDeps, processDocument, supplierHistory } from "~/lib/process.server";
import { vatIdFormatValid } from "~/lib/validator";

/** Production wiring: real or mock models, real VIES unless mocked, history from this tenant only. */
export async function processDeps(db: Db, tenantId: string): Promise<ProcessDeps> {
  const mock = process.env.AI_MOCK === "1";
  return {
    models: await getAgentModels(),
    today: todayInGermany(),
    research: {
      // The mock never calls the EU service: E2E runs and the demo stay offline.
      viesCheck: mock ? async (id) => ({ valid: vatIdFormatValid(id) ? null : false }) : (id) => viesCheckLive(id),
      supplierHistory: async (name) =>
        (await supplierHistory(db, tenantId, name)).map((r) => ({ lieferant: r.text, konto: r.account, text: r.text })),
    },
  };
}

export async function processMany(db: Db, tenantId: string, ids: string[]) {
  const deps = await processDeps(db, tenantId);
  return mapLimit(ids, PARALLEL_DOCUMENTS, (id) => processDocument(db, tenantId, id, deps));
}
