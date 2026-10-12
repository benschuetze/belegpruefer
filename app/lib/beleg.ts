import { z } from "zod";

/** A real calendar date, not just the shape: 2026-02-30 is refused here, not by the database later. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als yyyy-mm-dd")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "kein gültiges Datum");
/*
 * Upper bounds for everything that ends up in a prompt. A real invoice stays far below them; a 2 MB note would
 * otherwise go to every agent and cost money on every call, which the daily budget (counting calls) cannot see.
 */
const short = z.string().max(200);
const cents = z.number().int();

export const partySchema = z.object({
  name: short.min(1),
  street: short.optional(),
  postcode: short.optional(),
  city: short.optional(),
  /** ISO 3166-1 alpha-2 */
  country: z.string().length(2).optional(),
  vatId: z.string().max(30).optional(),
  taxNumber: z.string().max(30).optional(),
});

export const lineSchema = z.object({
  description: z.string().max(500),
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

/**
 * One incoming invoice in structured form, whatever it came from (XML parser, PDF extractor, eval set).
 * Amounts are integer cents, tax rates whole percent, dates yyyy-mm-dd. Optional means "not on the invoice";
 * the validator decides whether that is allowed.
 */
export const belegSchema = z.object({
  invoiceNumber: z.string().max(100).optional(),
  issueDate: isoDate.optional(),
  deliveryDate: isoDate.optional(),
  currency: z.string().length(3).default("EUR"),
  supplier: partySchema,
  buyer: partySchema.partial().optional(),
  lines: z.array(lineSchema).max(200),
  taxGroups: z.array(taxGroupSchema).max(10),
  totals: z.object({ netCents: cents, taxCents: cents, grossCents: cents }),
  /** Free text printed on the invoice: payment terms, "Steuerschuldnerschaft des Leistungsempfängers", guests. */
  notes: z.array(z.string().max(1000)).max(20).default([]),
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
