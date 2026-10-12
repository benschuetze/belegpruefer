import { describe, expect, it } from "vitest";
import { buildBeleg } from "../app/lib/beleg-builder";
import { compareExtraction } from "./extraction";

const expected = buildBeleg([{ description: "Papier", netCents: 1000 }], { invoiceNumber: "R-1" });

describe("Extraktion bewerten", () => {
  it("gleiche Felder sind richtig, Groß- und Kleinschreibung und Leerzeichen egal", () => {
    const actual = {
      ...expected,
      invoiceNumber: " r-1 ",
      supplier: { ...expected.supplier, name: "PAPIERWERK  SOMMER KG" },
    };
    expect(Object.values(compareExtraction(expected, actual)).every(Boolean)).toBe(true);
  });

  it("ein Cent Unterschied im Brutto ist falsch; nichts gelesen ist überall falsch", () => {
    const actual = { ...expected, totals: { ...expected.totals, grossCents: expected.totals.grossCents + 1 } };
    expect(compareExtraction(expected, actual).brutto).toBe(false);
    expect(Object.values(compareExtraction(expected, null)).some(Boolean)).toBe(false);
  });
});
