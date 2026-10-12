import { XMLParser } from "fast-xml-parser";
import { type Beleg, belegSchema } from "~/lib/beleg";
import { parseDecimalCents } from "~/lib/money";

export type ParseResult =
  | { ok: true; beleg: Beleg; profile: "XRechnung" | "ZUGFeRD" | "CII" }
  | { ok: false; reason: string };

export const MAX_XML_BYTES = 2 * 1024 * 1024;

const ARRAYS = new Set([
  "IncludedSupplyChainTradeLineItem",
  "ApplicableTradeTax",
  "IncludedNote",
  "SpecifiedTaxRegistration",
  "TaxTotalAmount",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  // Values stay strings: amounts are parsed to cents by our own code, never via a float.
  parseTagValue: false,
  parseAttributeValue: false,
  // Only the five predefined XML entities (&amp; …). Custom entities need a DOCTYPE, which is refused before
  // parsing, so nothing in a document can pull in other content or expand to gigabytes.
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => ARRAYS.has(name),
});

type Node = Record<string, unknown> | string | undefined;

function child(node: Node, ...path: string[]): Node {
  let current: unknown = node;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current as Node;
}

function list(node: Node, key: string): Node[] {
  const value = child(node, key);
  return Array.isArray(value) ? (value as Node[]) : value === undefined ? [] : [value];
}

function text(node: Node): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === "string") return node.trim() || undefined;
  const value = (node as Record<string, unknown>)["#text"];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || undefined : undefined;
}

function attr(node: Node, name: string): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const value = (node as Record<string, unknown>)[`@${name}`];
  return typeof value === "string" ? value : undefined;
}

/** CII format 102 is yyyymmdd. Anything else is reported, not guessed. */
function date(node: Node, field: string): string | undefined {
  const dateNode = child(node, "DateTimeString");
  const raw = text(dateNode);
  if (!raw) return undefined;
  const format = attr(dateNode, "format") ?? "102";
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (format !== "102" || !match)
    throw new ParseError(`${field}: Datumsformat ${format} „${raw}“ wird nicht unterstützt`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function amount(node: Node, field: string): number {
  const raw = text(node);
  if (raw === undefined) throw new ParseError(`${field} fehlt`);
  try {
    return parseDecimalCents(raw);
  } catch {
    throw new ParseError(`${field}: Betrag ist ungültig`);
  }
}

function rate(node: Node, field: string): number {
  const raw = text(node);
  if (raw === undefined) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ParseError(`${field}: Steuersatz wird nicht unterstützt (nur ganze Prozent)`);
  }
  return value;
}

class ParseError extends Error {}

function party(node: Node) {
  const address = child(node, "PostalTradeAddress");
  const registrations = list(node, "SpecifiedTaxRegistration").map((r) => child(r, "ID"));
  const byScheme = (scheme: string) => text(registrations.find((id) => attr(id, "schemeID") === scheme));
  return {
    name: text(child(node, "Name")) ?? "",
    street: text(child(address, "LineOne")),
    postcode: text(child(address, "PostcodeCode")),
    city: text(child(address, "CityName")),
    country: text(child(address, "CountryID"))?.toUpperCase(),
    vatId: byScheme("VA")?.replace(/\s+/g, "").toUpperCase(),
    taxNumber: byScheme("FC"),
  };
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * XRechnung (CII syntax) and ZUGFeRD/Factur-X XML share the UN/CEFACT Cross Industry Invoice. Deterministic: same
 * file, same result, no model involved. Fails with a reason a person can act on, never with a half-filled document.
 */
export function parseInvoiceXml(xml: string): ParseResult {
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) return { ok: false, reason: "Datei ist größer als 2 MB" };
  if (/<!DOCTYPE/i.test(xml)) return { ok: false, reason: "XML mit DOCTYPE wird aus Sicherheitsgründen abgelehnt" };

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml, true) as Record<string, unknown>;
  } catch (error) {
    return { ok: false, reason: `Kein gültiges XML: ${(error as Error).message.slice(0, 120)}` };
  }
  if ("Invoice" in doc || "CreditNote" in doc) {
    return { ok: false, reason: "UBL-Rechnungen werden noch nicht unterstützt, nur CII (XRechnung CII, ZUGFeRD)" };
  }
  const root = doc.CrossIndustryInvoice as Node;
  if (!root) return { ok: false, reason: "Keine elektronische Rechnung (CrossIndustryInvoice fehlt)" };

  try {
    const guideline =
      text(child(root, "ExchangedDocumentContext", "GuidelineSpecifiedDocumentContextParameter", "ID")) ?? "";
    const profile = /xrechnung/i.test(guideline)
      ? "XRechnung"
      : /factur-x|zugferd|en16931/i.test(guideline)
        ? "ZUGFeRD"
        : "CII";

    const header = child(root, "ExchangedDocument");
    const typeCode = text(child(header, "TypeCode"));
    if (typeCode === "381") return { ok: false, reason: "Gutschriften (Typ 381) werden noch nicht unterstützt" };

    const transaction = child(root, "SupplyChainTradeTransaction");
    const agreement = child(transaction, "ApplicableHeaderTradeAgreement");
    const settlement = child(transaction, "ApplicableHeaderTradeSettlement");
    const currency = text(child(settlement, "InvoiceCurrencyCode")) ?? "EUR";
    if (currency !== "EUR") return { ok: false, reason: `Währung ${currency}: nur EUR wird unterstützt` };

    const lines = list(transaction, "IncludedSupplyChainTradeLineItem").map((item, i) => {
      const lineSettlement = child(item, "SpecifiedLineTradeSettlement");
      const quantity = text(child(item, "SpecifiedLineTradeDelivery", "BilledQuantity"));
      return withoutUndefined({
        description: text(child(item, "SpecifiedTradeProduct", "Name")) ?? "",
        quantity: quantity === undefined ? undefined : Number(quantity),
        netCents: amount(
          child(lineSettlement, "SpecifiedTradeSettlementLineMonetarySummation", "LineTotalAmount"),
          `Position ${i + 1}: Nettobetrag`,
        ),
        taxRate: rate(
          child(list(lineSettlement, "ApplicableTradeTax")[0], "RateApplicablePercent"),
          `Position ${i + 1}`,
        ),
      });
    });

    const notes = list(header, "IncludedNote")
      .map((n) => text(child(n, "Content")))
      .filter((n): n is string => Boolean(n));
    const taxGroups = list(settlement, "ApplicableTradeTax").map((t, i) => {
      const reason = text(child(t, "ExemptionReason"));
      if (reason) notes.push(reason);
      return withoutUndefined({
        rate: rate(child(t, "RateApplicablePercent"), `Steuergruppe ${i + 1}`),
        netCents: amount(child(t, "BasisAmount"), `Steuergruppe ${i + 1}: Basis`),
        taxCents: amount(child(t, "CalculatedAmount"), `Steuergruppe ${i + 1}: Steuer`),
        category: text(child(t, "CategoryCode")),
      });
    });

    const summation = child(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");
    const taxTotals = list(summation, "TaxTotalAmount");
    const taxTotal = taxTotals.find((t) => (attr(t, "currencyID") ?? currency) === currency);

    const deliveryEvent = child(transaction, "ApplicableHeaderTradeDelivery", "ActualDeliverySupplyChainEvent");
    const candidate = {
      invoiceNumber: text(child(header, "ID")),
      issueDate: date(child(header, "IssueDateTime"), "Rechnungsdatum"),
      deliveryDate: deliveryEvent ? date(child(deliveryEvent, "OccurrenceDateTime"), "Leistungsdatum") : undefined,
      currency,
      supplier: withoutUndefined(party(child(agreement, "SellerTradeParty"))),
      buyer: withoutUndefined(party(child(agreement, "BuyerTradeParty"))),
      lines,
      taxGroups,
      totals: {
        netCents: amount(child(summation, "TaxBasisTotalAmount"), "Summe netto"),
        taxCents: taxTotal ? amount(taxTotal, "Summe Steuer") : 0,
        grossCents: amount(child(summation, "GrandTotalAmount"), "Summe brutto"),
      },
      notes,
    };
    const parsed = belegSchema.safeParse(withoutUndefined(candidate));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const reason = issue?.code === "too_big" ? "zu lang oder zu viele Einträge" : issue?.message;
      return { ok: false, reason: `Pflichtfeld fehlt oder ungültig: ${issue?.path.join(".")} (${reason})` };
    }
    return { ok: true, beleg: parsed.data, profile };
  } catch (error) {
    if (error instanceof ParseError) return { ok: false, reason: error.message };
    throw error;
  }
}
