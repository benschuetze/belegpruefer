import type { Beleg } from "~/lib/beleg";

/**
 * Writes a Beleg as CII XML (XRechnung or ZUGFeRD profile). Used for the demo data, the eval set and E2E uploads,
 * so test invoices are real e-invoice files rather than JSON. Not used on any production path.
 */
export function buildCiiXml(beleg: Beleg, profile: "XRechnung" | "ZUGFeRD" = "XRechnung"): string {
  const guideline =
    profile === "XRechnung"
      ? "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
      : "urn:cen.eu:en16931:2017";
  const amount = (cents: number) =>
    `${cents < 0 ? "-" : ""}${Math.trunc(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
  const date = (iso: string) => `<udt:DateTimeString format="102">${iso.replaceAll("-", "")}</udt:DateTimeString>`;
  const party = (p: Partial<Beleg["supplier"]> | undefined, tag: string) => {
    if (!p) return "";
    const address =
      p.street || p.postcode || p.city || p.country
        ? `<ram:PostalTradeAddress>${opt("ram:PostcodeCode", p.postcode)}${opt("ram:LineOne", p.street)}${opt("ram:CityName", p.city)}${opt("ram:CountryID", p.country)}</ram:PostalTradeAddress>`
        : "";
    const tax = [
      p.vatId
        ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(p.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>`
        : "",
      p.taxNumber
        ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(p.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>`
        : "",
    ].join("");
    return `<ram:${tag}>${opt("ram:Name", p.name)}${address}${tax}</ram:${tag}>`;
  };
  const category = (rate: number, given?: string) => given ?? (rate === 0 ? "E" : "S");

  const lines = beleg.lines
    .map(
      (l, i) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${esc(l.description)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${amount(Math.round(l.netCents / (l.quantity || 1)))}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${l.quantity ?? 1}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${category(l.taxRate, beleg.taxGroups.find((g) => g.rate === l.taxRate)?.category)}</ram:CategoryCode><ram:RateApplicablePercent>${l.taxRate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(l.netCents)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join("");
  const taxes = beleg.taxGroups
    .map(
      (g) =>
        `<ram:ApplicableTradeTax><ram:CalculatedAmount>${amount(g.taxCents)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${g.category === "AE" ? "<ram:ExemptionReason>Steuerschuldnerschaft des Leistungsempfängers</ram:ExemptionReason>" : ""}<ram:BasisAmount>${amount(g.netCents)}</ram:BasisAmount><ram:CategoryCode>${category(g.rate, g.category)}</ram:CategoryCode><ram:RateApplicablePercent>${g.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`,
    )
    .join("");
  const notes = beleg.notes
    .filter(
      (n) =>
        !(n === "Steuerschuldnerschaft des Leistungsempfängers" && beleg.taxGroups.some((g) => g.category === "AE")),
    )
    .map((n) => `<ram:IncludedNote><ram:Content>${esc(n)}</ram:Content></ram:IncludedNote>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${guideline}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    ${opt("ram:ID", beleg.invoiceNumber)}
    <ram:TypeCode>380</ram:TypeCode>
    ${beleg.issueDate ? `<ram:IssueDateTime>${date(beleg.issueDate)}</ram:IssueDateTime>` : ""}
    ${notes}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>${party(beleg.supplier, "SellerTradeParty")}${party(beleg.buyer, "BuyerTradeParty")}</ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>${beleg.deliveryDate ? `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>${date(beleg.deliveryDate)}</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>` : ""}</ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${beleg.currency}</ram:InvoiceCurrencyCode>
      ${taxes}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amount(beleg.lines.reduce((s, l) => s + l.netCents, 0))}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${amount(beleg.totals.netCents)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${beleg.currency}">${amount(beleg.totals.taxCents)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amount(beleg.totals.grossCents)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${amount(beleg.totals.grossCents)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function opt(tag: string, value: string | undefined): string {
  return value ? `<${tag}>${esc(value)}</${tag}>` : "";
}
