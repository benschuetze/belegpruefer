import type { Beleg } from "~/lib/beleg";
import { buildBeleg, type LineInput, reverseCharge } from "~/lib/beleg-builder";

export function makeBeleg(
  lines: LineInput[] = [{ description: "Kopierpapier A4", netCents: 10000 }],
  overrides: Partial<Beleg> = {},
): Beleg {
  return buildBeleg(lines, overrides);
}

export function makeReverseCharge(netCents = 41237, overrides: Partial<Beleg> = {}): Beleg {
  return reverseCharge([{ description: "Sponsored listings September", netCents }], {
    supplier: {
      name: "Clickwave Ads Ltd.",
      street: "14 Harbour Square",
      city: "Dublin",
      country: "IE",
      vatId: "IE1234567T",
    },
    ...overrides,
  });
}
