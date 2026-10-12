import { z } from "zod";
import type { Beleg } from "~/lib/beleg";
import { type AgentResult, callAgent } from "./call";
import { type BookingLine, bookingLineSchema } from "./kontierer";
import type { AgentModel } from "./models";
import { asData, belegForPrompt, PRUEFER_SYSTEM } from "./prompts";

export const prueferSchema = z.object({
  urteil: z.enum(["einverstanden", "einwand"]),
  begruendung: z.string().max(1200),
  gegenvorschlag: z.array(bookingLineSchema).nullable().optional(),
});

export type PrueferOutput = z.infer<typeof prueferSchema>;

/** Deliberately without the booker's confidence: the reviewer should judge the booking, not the booker's mood. */
export type PrueferInput = { beleg: Beleg; proposal: { zeilen: BookingLine[]; begruendung: string } };

export function prueferMessages(input: PrueferInput) {
  return [
    {
      role: "user" as const,
      content: [
        asData("beleg", belegForPrompt(input.beleg)),
        asData("vorschlag", input.proposal),
        "Prüfe diesen Vorschlag.",
      ].join("\n\n"),
    },
  ];
}

export function runPruefer(agent: AgentModel, input: PrueferInput): Promise<AgentResult<PrueferOutput>> {
  return callAgent({ agent, system: PRUEFER_SYSTEM, messages: prueferMessages(input), schema: prueferSchema });
}
