import { z } from "zod";

/**
 * One incoming invoice in structured form, whatever it came from (XML parser, PDF extractor, eval set).
 * Amounts are integer cents, tax rates whole percent, dates yyyy-mm-dd. Optional means "not on the invoice";
 * the validator decides whether that is allowed.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als yyyy-mm-dd");
const cents = z.number().int();

export const partySchema = z.object({
  name: z.string().min(1),
  street: z.string().optional(),
  postcode: z.string().optional(),
  city: z.string().optional(),
  /** ISO 3166-1 alpha-2 */
  country: z.string().length(2).optional(),
  vatId: z.string().optional(),
  taxNumber: z.string().optional(),
});

export const lineSchema = z.object({
  description: z.string(),
  quantity: z.number().optional(),
  netCents: cents,
  taxRate: z.number().int().min(0).max(100),
});

export const taxGroupSchema = z.object({
  rate: z.number().int().min(0).max(100),
  netCents: cents,
  taxCents: cents,
  /** UNTDID 5305: S standard, AE reverse charge, K intra-EU supply, E exempt, Z zero rated, O outside scope. */
  category: z.string().optional(),
});

export const belegSchema = z.object({
  invoiceNumber: z.string().optional(),
  issueDate: isoDate.optional(),
  deliveryDate: isoDate.optional(),
  currency: z.string().length(3).default("EUR"),
  supplier: partySchema,
  buyer: partySchema.partial().optional(),
  lines: z.array(lineSchema),
  taxGroups: z.array(taxGroupSchema),
  totals: z.object({ netCents: cents, taxCents: cents, grossCents: cents }),
  /** Free text printed on the invoice: payment terms, "Steuerschuldnerschaft des Leistungsempfängers", guests. */
  notes: z.array(z.string()).default([]),
});

export type Beleg = z.infer<typeof belegSchema>;
export type BelegLine = z.infer<typeof lineSchema>;
export type TaxGroup = z.infer<typeof taxGroupSchema>;

export const EU_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

export function supplierCountry(beleg: Beleg): string {
  return beleg.supplier.country ?? beleg.supplier.vatId?.slice(0, 2).toUpperCase() ?? "DE";
}

export function isForeignEu(beleg: Beleg): boolean {
  const country = supplierCountry(beleg);
  return country !== "DE" && EU_COUNTRIES.has(country === "EL" ? "GR" : country);
}

const REVERSE_CHARGE_NOTE = /steuerschuldnerschaft des leistungsempf|reverse charge|autoliquidation|§\s*13b/i;

export function mentionsReverseCharge(beleg: Beleg): boolean {
  return (
    beleg.notes.some((n) => REVERSE_CHARGE_NOTE.test(n)) ||
    beleg.taxGroups.some((g) => g.category === "AE") ||
    beleg.lines.some((l) => REVERSE_CHARGE_NOTE.test(l.description))
  );
}
