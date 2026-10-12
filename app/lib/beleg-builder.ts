import type { Beleg } from "~/lib/beleg";
import { taxOf } from "~/lib/money";

export type LineInput = { description: string; netCents: number; taxRate?: number; quantity?: number };

/**
 * A complete, correct invoice with sums computed from the lines. Demo data, eval set and tests change exactly
 * the part they are about, so a wrong total is always deliberate.
 */
export function buildBeleg(lines: LineInput[], overrides: Partial<Beleg> = {}): Beleg {
  const full = lines.map((l) => ({ quantity: 1, taxRate: 19, ...l }));
  const rates = [...new Set(full.map((l) => l.taxRate))];
  const taxGroups = rates.map((rate) => {
    const netCents = full.filter((l) => l.taxRate === rate).reduce((s, l) => s + l.netCents, 0);
    return { rate, netCents, taxCents: taxOf(netCents, rate), category: rate === 0 ? "E" : "S" };
  });
  const netCents = taxGroups.reduce((s, g) => s + g.netCents, 0);
  const taxCents = taxGroups.reduce((s, g) => s + g.taxCents, 0);
  return {
    invoiceNumber: "R-2026-001",
    issueDate: "2026-09-15",
    deliveryDate: "2026-09-14",
    currency: "EUR",
    supplier: {
      name: "Papierwerk Sommer KG",
      street: "Mühlenweg 12",
      postcode: "34117",
      city: "Kassel",
      country: "DE",
      vatId: "DE123456789",
    },
    buyer: {
      name: "Feldbach Design GmbH",
      street: "Am Kanal 7",
      postcode: "04109",
      city: "Leipzig",
      country: "DE",
      vatId: "DE987654321",
    },
    lines: full,
    taxGroups,
    totals: { netCents, taxCents, grossCents: netCents + taxCents },
    notes: [],
    ...overrides,
  };
}

/** A service from another EU country without German VAT, as invoiced under § 13b UStG. */
export function reverseCharge(lines: LineInput[], overrides: Partial<Beleg> = {}): Beleg {
  const base = buildBeleg(
    lines.map((l) => ({ ...l, taxRate: 0 })),
    overrides,
  );
  return {
    ...base,
    taxGroups: [{ rate: 0, netCents: base.totals.netCents, taxCents: 0, category: "AE" }],
    notes: overrides.notes ?? ["Steuerschuldnerschaft des Leistungsempfängers"],
  };
}
