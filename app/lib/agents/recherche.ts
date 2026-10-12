import { stepCountIs, tool } from "ai";
import { z } from "zod";
import type { Beleg } from "~/lib/beleg";
import { type AgentResult, callAgent } from "./call";
import type { AgentModel } from "./models";
import { asData, belegForPrompt, RECHERCHE_SYSTEM } from "./prompts";

export const MAX_RESEARCH_STEPS = 4;

export const rechercheSchema = z.object({
  verkauft: z.string().max(300),
  land: z.string().max(2),
  ustIdGueltig: z.boolean().nullable(),
  zusammenfassung: z.string().max(500),
});
export type RechercheOutput = z.infer<typeof rechercheSchema>;

export type ViesResult = { valid: boolean | null; name?: string | null };

/** Both read-only. The agent can look things up but has no way to write anything. */
export type ResearchTools = {
  viesCheck: (vatId: string) => Promise<ViesResult>;
  supplierHistory: (name: string) => Promise<{ lieferant: string; konto: string; text: string }[]>;
};

export function runRecherche(
  agent: AgentModel,
  beleg: Beleg,
  research: ResearchTools,
): Promise<AgentResult<RechercheOutput>> {
  const tools = {
    vies_pruefen: tool({
      description: "Prüft eine USt-IdNr. im EU-System VIES. Nur lesend.",
      inputSchema: z.object({ ustId: z.string().min(4).max(20) }),
      execute: async ({ ustId }) => research.viesCheck(ustId),
    }),
    lieferant_historie: tool({
      description:
        "Frühere, bestätigte Buchungen dieses Mandanten bei einem Lieferanten mit ähnlichem Namen. Nur lesend.",
      inputSchema: z.object({ name: z.string().min(2).max(120) }),
      execute: async ({ name }) => research.supplierHistory(name),
    }),
  };
  const positions = { lieferant: belegForPrompt(beleg).lieferant, positionen: beleg.lines.map((l) => l.description) };
  return callAgent({
    agent,
    system: RECHERCHE_SYSTEM,
    messages: [{ role: "user", content: `${asData("beleg", positions)}\n\nErstelle das Kurzprofil.` }],
    schema: rechercheSchema,
    tools,
    stopWhen: stepCountIs(MAX_RESEARCH_STEPS),
  });
}

/** The public VIES REST service. Errors and timeouts answer "unknown", never "valid". */
export async function viesCheckLive(vatId: string, fetchImpl: typeof fetch = fetch): Promise<ViesResult> {
  const normalized = vatId.replace(/\s+/g, "").toUpperCase();
  const countryCode = normalized.slice(0, 2);
  const vatNumber = normalized.slice(2);
  try {
    const response = await fetchImpl("https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ countryCode, vatNumber }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { valid: null };
    const body = (await response.json()) as { valid?: boolean; name?: string };
    return { valid: typeof body.valid === "boolean" ? body.valid : null, name: body.name ?? null };
  } catch {
    return { valid: null };
  }
}
