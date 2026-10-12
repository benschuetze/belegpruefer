import { type Example, type KontiererOutput, runKontierer } from "~/lib/agents/kontierer";
import type { AgentModels } from "~/lib/agents/models";
import { PROMPT_VERSIONS } from "~/lib/agents/prompts";
import { type PrueferOutput, runPruefer } from "~/lib/agents/pruefer";
import { MAX_RESEARCH_STEPS, type RechercheOutput, type ResearchTools, runRecherche } from "~/lib/agents/recherche";
import type { Beleg } from "~/lib/beleg";
import type { NewDecision, SupplierProfile } from "~/lib/db/schema";

export type Team = {
  /** Eval ablation switches; production runs with all three. */
  pruefer: boolean;
  recherche: boolean;
  examples: boolean;
};
export const FULL_TEAM: Team = { pruefer: true, recherche: true, examples: true };

export type Step = Omit<NewDecision, "tenantId" | "documentId" | "runId">;

export type TeamInput = {
  models: AgentModels;
  beleg: Beleg;
  tenantName: string;
  /** Confirmed bookings of this tenant at this supplier, newest first. */
  history: Example[];
  knownProfile: SupplierProfile | null;
  team: Team;
  research: ResearchTools;
};

export type TeamResult = {
  steps: Step[];
  kontierer: KontiererOutput | null;
  /** undefined when the team has no reviewer, null when the reviewer gave no usable answer. */
  pruefer: PrueferOutput | null | undefined;
  profile: SupplierProfile | null;
  researched: boolean;
};

export function unknownSupplier(knownProfile: SupplierProfile | null, history: Example[]): boolean {
  return !knownProfile && history.length === 0;
}

/** Upper bound of model calls for this document, for the daily budget. Research may take one call per step. */
export function plannedCalls(team: Team, unknown: boolean): number {
  return 1 + (team.pruefer ? 1 : 0) + (team.recherche && unknown ? MAX_RESEARCH_STEPS : 0);
}

/**
 * The agent part of the chain, shared by production (`processDocument`) and `pnpm eval`, so both run the same
 * agents and the same decision. What differs is only the input: production loads history and stored supplier
 * profiles from the database, the eval derives history from earlier eval cases and has no stored profiles.
 * Only reads and proposes; it writes nothing.
 */
export async function runTeam(input: TeamInput): Promise<TeamResult> {
  const { models, beleg, team } = input;
  const steps: Step[] = [];
  let profile = input.knownProfile;
  let researched: RechercheOutput | null = null;

  if (team.recherche && unknownSupplier(input.knownProfile, input.history)) {
    const research = await runRecherche(models.recherche, beleg, input.research);
    researched = research.output;
    if (researched) {
      profile = {
        sells: researched.verkauft,
        country: researched.land,
        vatIdValid: researched.ustIdGueltig,
        summary: researched.zusammenfassung,
      };
    }
    steps.push(agentStep("recherche", research, { lieferant: beleg.supplier.name }));
  }

  const examples = team.examples ? input.history.slice(0, 5) : [];
  const booked = await runKontierer(models.kontierer, { beleg, tenantName: input.tenantName, examples, profile });
  const kontierer = booked.output;
  steps.push({ ...agentStep("kontierer", booked, { examples, profile }), confidence: kontierer?.konfidenz ?? null });

  let pruefer: PrueferOutput | null | undefined;
  if (team.pruefer) {
    pruefer = null;
    if (kontierer) {
      const reviewed = await runPruefer(models.pruefer, {
        beleg,
        proposal: { zeilen: kontierer.zeilen, begruendung: kontierer.begruendung },
      });
      pruefer = reviewed.output;
      steps.push(agentStep("pruefer", reviewed, { zeilen: kontierer.zeilen }));
    }
  }
  return { steps, kontierer, pruefer, profile, researched: researched !== null };
}

type AgentCall = {
  output: unknown;
  error: string | null;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  costMicrocents: number;
  durationMs: number;
};

export function agentStep(role: "recherche" | "kontierer" | "pruefer", result: AgentCall, input: unknown): Step {
  return {
    role,
    model: result.model,
    promptVersion: PROMPT_VERSIONS[role],
    input,
    output: result.output ?? { error: result.error },
    tokensIn: result.usage.inputTokens,
    tokensOut: result.usage.outputTokens,
    costMicrocents: result.costMicrocents,
    durationMs: result.durationMs,
  };
}
