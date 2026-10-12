import { z } from "zod";
import { type Beleg, belegSchema } from "~/lib/beleg";
import { parseDecimalCents } from "~/lib/money";
import { callAgent } from "./call";
import type { AgentModel, Usage } from "./models";
import { EXTRAKTOR_SYSTEM } from "./prompts";

const amount = z.string().regex(/^-?\d+(\.\d{1,2})?$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const conf = z.number().min(0).max(1);

/** What the vision model fills in. Amounts as strings so no float reaches the cents. */
export const extraktorSchema = z.object({
  rechnungsnummer: z.string().nullable(),
  rechnungsdatum: date,
  leistungsdatum: date,
  lieferant: z.object({
    name: z.string(),
    strasse: z.string().nullable(),
    plz: z.string().nullable(),
    ort: z.string().nullable(),
    land: z.string().length(2).nullable(),
    ustId: z.string().nullable(),
    steuernummer: z.string().nullable(),
  }),
  empfaenger: z.object({ name: z.string().nullable(), ustId: z.string().nullable() }),
  positionen: z.array(
    z.object({ text: z.string(), menge: z.number().nullable(), netto: amount, steuersatz: z.number().int() }),
  ),
  steuergruppen: z.array(z.object({ satz: z.number().int(), netto: amount, steuer: amount })),
  summe: z.object({ netto: amount, steuer: amount, brutto: amount }),
  hinweise: z.array(z.string()),
  konfidenz: z.object({
    lieferant: conf,
    rechnungsnummer: conf,
    rechnungsdatum: conf,
    positionen: conf,
    summen: conf,
    ustId: conf,
  }),
});
export type ExtraktorOutput = z.infer<typeof extraktorSchema>;

export function toBeleg(out: ExtraktorOutput): Beleg | null {
  const nz = <T>(v: T | null): T | undefined => (v === null || v === "" ? undefined : v);
  const candidate = {
    invoiceNumber: nz(out.rechnungsnummer),
    issueDate: nz(out.rechnungsdatum),
    deliveryDate: nz(out.leistungsdatum),
    currency: "EUR",
    supplier: Object.fromEntries(
      Object.entries({
        name: out.lieferant.name,
        street: nz(out.lieferant.strasse),
        postcode: nz(out.lieferant.plz),
        city: nz(out.lieferant.ort),
        country: nz(out.lieferant.land)?.toUpperCase(),
        vatId: nz(out.lieferant.ustId)?.replace(/\s+/g, "").toUpperCase(),
        taxNumber: nz(out.lieferant.steuernummer),
      }).filter(([, v]) => v !== undefined),
    ),
    buyer: Object.fromEntries(
      Object.entries({ name: nz(out.empfaenger.name), vatId: nz(out.empfaenger.ustId) }).filter(
        ([, v]) => v !== undefined,
      ),
    ),
    lines: out.positionen.map((p) => ({
      description: p.text,
      ...(p.menge === null ? {} : { quantity: p.menge }),
      netCents: parseDecimalCents(p.netto),
      taxRate: p.steuersatz,
    })),
    taxGroups: out.steuergruppen.map((g) => ({
      rate: g.satz,
      netCents: parseDecimalCents(g.netto),
      taxCents: parseDecimalCents(g.steuer),
      ...(g.satz === 0 && out.hinweise.some((h) => /steuerschuldnerschaft|reverse charge/i.test(h))
        ? { category: "AE" }
        : {}),
    })),
    totals: {
      netCents: parseDecimalCents(out.summe.netto),
      taxCents: parseDecimalCents(out.summe.steuer),
      grossCents: parseDecimalCents(out.summe.brutto),
    },
    notes: out.hinweise,
  };
  const parsed = belegSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export type ExtractResult = {
  beleg: Beleg | null;
  output: ExtraktorOutput | null;
  minConfidence: number;
  error: string | null;
  usage: Usage;
  costMicrocents: number;
  durationMs: number;
  model: string;
};

export async function extractPdf(agent: AgentModel, pdf: Uint8Array): Promise<ExtractResult> {
  const result = await callAgent({
    agent,
    system: EXTRAKTOR_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: pdf, mediaType: "application/pdf" },
          { type: "text", text: "Lies diese Rechnung aus." },
        ],
      },
    ],
    schema: extraktorSchema,
    maxOutputTokens: 6000,
  });
  const beleg = result.output ? toBeleg(result.output) : null;
  return {
    beleg,
    output: result.output,
    minConfidence: result.output ? Math.min(...Object.values(result.output.konfidenz)) : 0,
    error: result.output && !beleg ? "Felder passen nicht zum Belegformat" : result.error,
    usage: result.usage,
    costMicrocents: result.costMicrocents,
    durationMs: result.durationMs,
    model: result.model,
  };
}
