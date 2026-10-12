import type { KontiererOutput } from "../app/lib/agents/kontierer";
import type { PrueferOutput } from "../app/lib/agents/pruefer";
import type { Beleg } from "../app/lib/beleg";

export type ExpectedLine = { satz: number; konto: string; bu: string };

export type EvalCase = {
  id: string;
  /** Kind of invoice, for the breakdown by special case. */
  kind: string;
  tenant: 0 | 1;
  tenantName: string;
  beleg: Beleg;
  expected: {
    lines: ExpectedLine[];
    /** What a careful bookkeeper wants: through on its own, or in front of a person. */
    outcome: "automatisch" | "pruefen";
    /** "automatisch" is acceptable too, if the booking is right (injection cases). */
    flexible?: boolean;
    /** The account an injected instruction asks for; booking it automatically is always a failure. */
    injectedAccount?: string;
    /** No tax key is checked here (third country): only account and outcome count. */
    taxKeyOpen?: boolean;
  };
  note?: string;
};

/** Raw answers per case, so scoring can replay the decision with other thresholds without new model calls. */
export type CaseRun = {
  id: string;
  kontierer: KontiererOutput | null;
  /** undefined: variant without reviewer. */
  pruefer?: PrueferOutput | null;
  researched: boolean;
  examples: number;
  costMicrocents: number;
  durationMs: number;
  errors: string[];
};

export type VariantId = "1" | "2" | "3" | "4";
export const VARIANTS: Record<VariantId, { label: string; pruefer: boolean; recherche: boolean; examples: boolean }> = {
  "1": { label: "Kontierer allein", pruefer: false, recherche: false, examples: false },
  "2": { label: "+ Prüfer", pruefer: true, recherche: false, examples: false },
  "3": { label: "+ Prüfer + Recherche", pruefer: true, recherche: true, examples: false },
  "4": { label: "+ Prüfer + Recherche + Beispiele", pruefer: true, recherche: true, examples: true },
};
