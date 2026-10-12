import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Beleg } from "~/lib/beleg";
import { buildCiiXml } from "./build-cii";
import { parseInvoiceXml } from "./cii";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

function parsed(xml: string): Beleg {
  const result = parseInvoiceXml(xml);
  if (!result.ok) throw new Error(result.reason);
  return result.beleg;
}

describe("XRechnung (CII), von Hand geschrieben", () => {
  const result = parseInvoiceXml(fixture("xrechnung-papierwerk.xml"));

  it("erkennt das Profil und liest Kopf, Parteien und Daten", () => {
    expect(result.ok && result.profile).toBe("XRechnung");
    const beleg = parsed(fixture("xrechnung-papierwerk.xml"));
    expect(beleg.invoiceNumber).toBe("PW-2026-0815");
    expect(beleg.issueDate).toBe("2026-09-03");
    expect(beleg.deliveryDate).toBe("2026-09-01");
    expect(beleg.supplier).toMatchObject({
      name: "Papierwerk Sommer KG",
      street: "Mühlenweg 12",
      postcode: "34117",
      city: "Kassel",
      country: "DE",
      vatId: "DE123456789",
      taxNumber: "026 123 45678",
    });
    expect(beleg.buyer?.name).toBe("Feldbach Design GmbH");
  });

  it("liest Positionen und Steuergruppen auf den Cent, mit Umlauten und &amp;", () => {
    const beleg = parsed(fixture("xrechnung-papierwerk.xml"));
    expect(beleg.lines).toEqual([
      { description: "Kopierpapier A4, 80 g, Karton à 5 Pack", quantity: 3, netCents: 7470, taxRate: 19 },
      { description: "Gelstifte blau, 10er-Set", quantity: 2, netCents: 2500, taxRate: 19 },
      { description: "Fachbuch „Typografie im Alltag“", quantity: 1, netCents: 2800, taxRate: 7 },
    ]);
    expect(beleg.taxGroups).toEqual([
      { rate: 19, netCents: 9970, taxCents: 1894, category: "S" },
      { rate: 7, netCents: 2800, taxCents: 196, category: "S" },
    ]);
    expect(beleg.totals).toEqual({ netCents: 12770, taxCents: 2090, grossCents: 14860 });
    expect(beleg.notes[0]).toContain("Papier & Stifte");
  });
});

describe("ZUGFeRD mit Reverse Charge, von Hand geschrieben", () => {
  it("liest Steuerkategorie AE und übernimmt den Befreiungsgrund als Hinweis", () => {
    const result = parseInvoiceXml(fixture("zugferd-clickwave.xml"));
    expect(result.ok && result.profile).toBe("ZUGFeRD");
    const beleg = parsed(fixture("zugferd-clickwave.xml"));
    expect(beleg.supplier.country).toBe("IE");
    expect(beleg.taxGroups).toEqual([{ rate: 0, netCents: 41237, taxCents: 0, category: "AE" }]);
    expect(beleg.notes).toContain("Reverse charge – Steuerschuldnerschaft des Leistungsempfängers");
    expect(beleg.deliveryDate).toBeUndefined();
  });
});

describe("Ablehnung mit Grund statt halber Daten", () => {
  it.each([
    ["kein XML", "das ist keine rechnung", /CrossIndustryInvoice fehlt|Kein gültiges XML/],
    ["UBL", '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>', /UBL/],
    [
      "DOCTYPE mit Entität",
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><rsm:CrossIndustryInvoice/>',
      /DOCTYPE/,
    ],
    ["fremde Währung", fixture("xrechnung-papierwerk.xml").replace(">EUR<", ">USD<"), /Währung USD/],
    [
      "Betrag mit drei Nachkommastellen",
      fixture("xrechnung-papierwerk.xml").replace("<ram:LineTotalAmount>74.70", "<ram:LineTotalAmount>74.705"),
      /Position 1: Nettobetrag/,
    ],
    [
      "Steuersatz 5,5",
      fixture("xrechnung-papierwerk.xml").replace("<ram:RateApplicablePercent>7<", "<ram:RateApplicablePercent>5.5<"),
      /Steuersatz „5.5“/,
    ],
    [
      "Lieferant ohne Namen",
      fixture("xrechnung-papierwerk.xml").replace("<ram:Name>Papierwerk Sommer KG</ram:Name>", ""),
      /supplier\.name/,
    ],
    ["Gutschrift", fixture("xrechnung-papierwerk.xml").replace("<ram:TypeCode>380", "<ram:TypeCode>381"), /Gutschrift/],
  ])("%s", (_name, xml, reason) => {
    const result = parseInvoiceXml(xml);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  it("fehlende Rechnungsnummer ist kein Parserfehler, sondern ein Fall für den Validator", () => {
    const beleg = parsed(fixture("xrechnung-papierwerk.xml").replace("<ram:ID>PW-2026-0815</ram:ID>", ""));
    expect(beleg.invoiceNumber).toBeUndefined();
  });
});

describe("Generator für Test- und Demodaten", () => {
  it("was buildCiiXml schreibt, liest der Parser unverändert zurück", () => {
    const original = parsed(fixture("xrechnung-papierwerk.xml"));
    for (const profile of ["XRechnung", "ZUGFeRD"] as const) {
      const again = parsed(buildCiiXml(original, profile));
      expect(again).toEqual(original);
    }
  });
});
