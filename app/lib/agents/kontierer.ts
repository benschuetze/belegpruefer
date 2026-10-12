import { z } from "zod";
import type { Beleg } from "~/lib/beleg";
import type { SupplierProfile } from "~/lib/db/schema";
import { ACCOUNT_NUMBERS, TAX_KEY_VALUES } from "~/lib/skr03";
import { type AgentResult, callAgent } from "./call";
import type { AgentModel } from "./models";
import { asData, belegForPrompt, KONTIERER_SYSTEM } from "./prompts";

export const bookingLineSchema = z.object({
  satz: z.number().int(),
  konto: z.enum(ACCOUNT_NUMBERS),
  buSchluessel: z.enum(TAX_KEY_VALUES),
});

export const kontiererSchema = z.object({
  zeilen: z.array(bookingLineSchema).min(1),
  konfidenz: z.number().min(0).max(1),
  begruendung: z.string().max(1200),
});

export type KontiererOutput = z.infer<typeof kontiererSchema>;
export type BookingLine = z.infer<typeof bookingLineSchema>;

/** A confirmed booking from this tenant's history, shown as an example. Only account facts, no amounts of others. */
export type Example = { lieferant: string; positionen: string[]; konto: string; buSchluessel: string };

export type KontiererInput = {
  beleg: Beleg;
  tenantName: string;
  examples: Example[];
  profile: SupplierProfile | null;
};

export function kontiererMessages(input: KontiererInput) {
  const parts = [
    `Mandant: ${input.tenantName}`,
    asData("beleg", belegForPrompt(input.beleg)),
    input.examples.length > 0 ? asData("beispiele", input.examples) : "",
    input.profile ? asData("lieferantenprofil", input.profile) : "",
    "Kontiere diesen Beleg.",
  ];
  return [{ role: "user" as const, content: parts.filter(Boolean).join("\n\n") }];
}

export function runKontierer(agent: AgentModel, input: KontiererInput): Promise<AgentResult<KontiererOutput>> {
  return callAgent({ agent, system: KONTIERER_SYSTEM, messages: kontiererMessages(input), schema: kontiererSchema });
}

/** The proposal must cover exactly the tax rates on the document; anything else is unusable, not "close enough". */
export function coversTaxGroups(beleg: Beleg, lines: BookingLine[]): boolean {
  const rates = new Set(beleg.taxGroups.map((g) => g.rate));
  const proposed = new Set(lines.map((l) => l.satz));
  return rates.size === proposed.size && [...rates].every((r) => proposed.has(r)) && lines.length === rates.size;
}
