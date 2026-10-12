import type { Beleg } from "../app/lib/beleg";

export const FIELDS = [
  "rechnungsnummer",
  "rechnungsdatum",
  "lieferant",
  "ustId",
  "netto",
  "steuer",
  "brutto",
  "positionen",
  "steuersaetze",
] as const;
export type Field = (typeof FIELDS)[number];

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Field by field: did the extractor read what is printed? Missing on both sides counts as right. */
export function compareExtraction(expected: Beleg, actual: Beleg | null): Record<Field, boolean> {
  const rates = (b: Beleg) =>
    b.taxGroups
      .map((g) => g.rate)
      .sort()
      .join(",");
  return {
    rechnungsnummer: norm(actual?.invoiceNumber) === norm(expected.invoiceNumber),
    rechnungsdatum: actual?.issueDate === expected.issueDate,
    lieferant: norm(actual?.supplier.name) === norm(expected.supplier.name),
    ustId: norm(actual?.supplier.vatId) === norm(expected.supplier.vatId),
    netto: actual?.totals.netCents === expected.totals.netCents,
    steuer: actual?.totals.taxCents === expected.totals.taxCents,
    brutto: actual?.totals.grossCents === expected.totals.grossCents,
    positionen: actual?.lines.length === expected.lines.length,
    steuersaetze: actual ? rates(actual) === rates(expected) : false,
  };
}
