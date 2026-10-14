import { type Beleg, isForeignEu, mentionsReverseCharge } from "~/lib/beleg";
import type { Finding } from "~/lib/db/schema";
import { taxOf } from "~/lib/money";
import { GWG_LIMIT_NET_CENTS, SMALL_INVOICE_LIMIT_GROSS_CENTS } from "~/lib/skr03";

/**
 * Format of VAT ids per EU country (VIES syntax). Checks the shape only; whether the id exists is VIES's job
 * (research agent). Greece uses EL in VAT ids.
 */
const VAT_ID_FORMAT: Record<string, RegExp> = {
  AT: /^ATU\d{8}$/,
  BE: /^BE[01]\d{9}$/,
  BG: /^BG\d{9,10}$/,
  CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/,
  DE: /^DE\d{9}$/,
  DK: /^DK\d{8}$/,
  EE: /^EE\d{9}$/,
  EL: /^EL\d{9}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^FI\d{8}$/,
  FR: /^FR[A-HJ-NP-Z0-9]{2}\d{9}$/,
  HR: /^HR\d{11}$/,
  HU: /^HU\d{8}$/,
  IE: /^IE\d{7}[A-W][A-I]?$|^IE\d[A-Z+*]\d{5}[A-W]$/,
  IT: /^IT\d{11}$/,
  LT: /^LT(\d{9}|\d{12})$/,
  LU: /^LU\d{8}$/,
  LV: /^LV\d{11}$/,
  MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/,
  PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/,
  SI: /^SI\d{8}$/,
  SK: /^SK\d{10}$/,
};

export function vatIdFormatValid(vatId: string): boolean {
  const normalized = vatId.replace(/\s+/g, "").toUpperCase();
  const pattern = VAT_ID_FORMAT[normalized.slice(0, 2)];
  return pattern ? pattern.test(normalized) : false;
}

/** The limit is per item: two monitors at 499 € are two GWG, not one asset at 998 €. */
export function aboveGwgLimit(line: Beleg["lines"][number]): boolean {
  return line.netCents > GWG_LIMIT_NET_CENTS * Math.max(1, line.quantity ?? 1);
}

export function isSmallInvoice(beleg: Beleg): boolean {
  return beleg.totals.grossCents <= SMALL_INVOICE_LIMIT_GROSS_CENTS;
}

const fehler = (code: string, message: string): Finding => ({ code, severity: "fehler", message });
const hinweis = (code: string, message: string): Finding => ({ code, severity: "hinweis", message });

/**
 * Code, not a model: checks that hold for every invoice regardless of how it is booked.
 * "fehler" sends the document to review, "hinweis" is shown but does not block on its own.
 */
export function validateBeleg(beleg: Beleg, today: string): Finding[] {
  const findings: Finding[] = [];
  const reverseCharge = mentionsReverseCharge(beleg);
  // § 33 Satz 3 UStDV: no small-invoice relief for § 13b services.
  const small = isSmallInvoice(beleg) && !reverseCharge;

  // Sums: lines → tax groups → totals, each to the cent.
  const lineNet = beleg.lines.reduce((s, l) => s + l.netCents, 0);
  const groupNet = beleg.taxGroups.reduce((s, g) => s + g.netCents, 0);
  const groupTax = beleg.taxGroups.reduce((s, g) => s + g.taxCents, 0);
  if (beleg.lines.length === 0) findings.push(fehler("positionen_fehlen", "Die Rechnung hat keine Positionen."));
  if (beleg.lines.length > 0 && lineNet !== beleg.totals.netCents) {
    findings.push(fehler("summe_positionen", "Die Positionen ergeben nicht die Nettosumme."));
  }
  if (beleg.taxGroups.length > 0 && groupNet !== beleg.totals.netCents) {
    findings.push(fehler("summe_steuergruppen", "Die Steuergruppen ergeben nicht die Nettosumme."));
  }
  if (beleg.taxGroups.length > 0 && groupTax !== beleg.totals.taxCents) {
    findings.push(fehler("summe_steuer", "Die Steuerbeträge ergeben nicht die Steuersumme."));
  }
  if (beleg.totals.netCents + beleg.totals.taxCents !== beleg.totals.grossCents) {
    findings.push(fehler("summe_brutto", "Netto plus Steuer ergibt nicht den Bruttobetrag."));
  }
  for (const group of beleg.taxGroups) {
    // One cent either way: invoices may round per line instead of per group, both are allowed.
    const expected = taxOf(group.netCents, group.rate);
    if (Math.abs(expected - group.taxCents) > 1) {
      findings.push(fehler("steuer_falsch", `Steuer zu ${group.rate} % passt nicht zur Bemessungsgrundlage.`));
    }
    if (![0, 7, 19].includes(group.rate)) {
      findings.push(fehler("steuersatz", `Steuersatz ${group.rate} % gibt es in Deutschland nicht.`));
    }
  }
  for (const line of beleg.lines) {
    if (!beleg.taxGroups.some((g) => g.rate === line.taxRate) && beleg.taxGroups.length > 0) {
      findings.push(fehler("steuergruppe_fehlt", `Für ${line.taxRate} % fehlt die Steuergruppe.`));
      break;
    }
  }

  // § 14 (4) UStG, or § 33 UStDV for invoices up to 250 € gross.
  const s = beleg.supplier;
  if (!s.street || !s.city) findings.push(fehler("anschrift_lieferant", "Anschrift des Lieferanten fehlt."));
  if (!beleg.issueDate) findings.push(fehler("datum_fehlt", "Rechnungsdatum fehlt."));
  if (beleg.lines.some((l) => !l.description.trim())) {
    findings.push(fehler("leistung_fehlt", "Eine Position hat keine Beschreibung der Leistung."));
  }
  if (!small) {
    if (!beleg.invoiceNumber) findings.push(fehler("rechnungsnummer_fehlt", "Rechnungsnummer fehlt."));
    if (!s.vatId && !s.taxNumber) {
      findings.push(fehler("steuernummer_fehlt", "Weder USt-IdNr. noch Steuernummer des Lieferanten angegeben."));
    }
    if (!beleg.buyer?.name) findings.push(fehler("empfaenger_fehlt", "Name des Leistungsempfängers fehlt."));
    else if (!beleg.buyer.street || !beleg.buyer.city) {
      findings.push(
        fehler("empfaenger_anschrift", "Anschrift des Leistungsempfängers fehlt (§ 14 Abs. 4 Nr. 1 UStG)."),
      );
    }
    if (!beleg.deliveryDate) {
      findings.push(
        hinweis("leistungsdatum", "Kein Leistungsdatum angegeben. Zulässig, wenn es dem Rechnungsdatum entspricht."),
      );
    }
  }

  if (s.vatId && !vatIdFormatValid(s.vatId)) {
    findings.push(fehler("ust_id_format", `USt-IdNr. ${s.vatId} hat nicht das Format des Landes.`));
  }

  if (beleg.issueDate) {
    if (beleg.issueDate > today) findings.push(fehler("datum_zukunft", "Rechnungsdatum liegt in der Zukunft."));
    const tenYearsAgo = `${Number(today.slice(0, 4)) - 10}${today.slice(4)}`;
    if (beleg.issueDate < tenYearsAgo) findings.push(hinweis("datum_alt", "Rechnung ist älter als zehn Jahre."));
  }

  // Reverse charge: an EU supplier without German VAT must say so, and needs a VAT id on both sides.
  if (isForeignEu(beleg) && beleg.totals.taxCents === 0) {
    if (!reverseCharge) {
      findings.push(
        fehler(
          "reverse_charge_hinweis",
          "Rechnung aus dem EU-Ausland ohne Steuer und ohne Hinweis auf Reverse Charge.",
        ),
      );
    }
    if (!s.vatId) findings.push(fehler("reverse_charge_ust_id", "Reverse Charge ohne USt-IdNr. des Lieferanten."));
    if (!beleg.buyer?.vatId) {
      findings.push(hinweis("reverse_charge_eigene_ust_id", "Eigene USt-IdNr. fehlt auf der Rechnung."));
    }
  }
  if (!isForeignEu(beleg) && beleg.totals.taxCents === 0 && !small && !reverseCharge) {
    findings.push(hinweis("ohne_steuer", "Inländische Rechnung ohne Umsatzsteuer: Kleinunternehmer oder steuerfrei?"));
  }

  findings.push(...instructionFindings(beleg));
  if (beleg.lines.some((l) => VAGUE_SUPPLY.test(l.description))) {
    findings.push(
      hinweis(
        LIEFERSCHEIN_CODE,
        "Die Leistung ist nur über einen Lieferschein beschrieben (§ 14 Abs. 4 Nr. 5 UStG). Ohne den Lieferschein ist der Vorsteuerabzug unsicher: Lieferschein anfordern.",
      ),
    );
  }

  if (beleg.lines.some(aboveGwgLimit)) {
    findings.push(hinweis("ueber_gwg_grenze", "Eine Position liegt über 800 € netto: möglicherweise Anlagevermögen."));
  }
  return findings;
}

const GUESTS = /teilnehm|bewirtete personen|gäste/i;
const OCCASION = /anlass/i;

/** Checks that depend on the account chosen: entertainment needs occasion and guests (§ 4 (5) Nr. 2 EStG). */
export function validateBooking(beleg: Beleg, account: string): Finding[] {
  const findings: Finding[] = [];
  if (account === "4650") {
    const text = beleg.notes.join("\n");
    if (!OCCASION.test(text) || !GUESTS.test(text)) {
      findings.push(
        fehler(
          "bewirtung_angaben",
          "Bewirtung: Anlass und bewirtete Personen fehlen (§ 4 Abs. 5 Nr. 2 EStG). Ort, Tag, Bewirtender und maschinelle Rechnung bitte selbst prüfen.",
        ),
      );
    }
  }
  if (account === "4855" && beleg.lines.some(aboveGwgLimit)) {
    findings.push(fehler("gwg_grenze", "GWG-Sofortabschreibung, aber eine Position liegt über 800 € netto."));
  }
  return findings;
}

/**
 * Text that talks to the bookkeeping instead of describing goods. Invoices do not tell anyone how to book them;
 * if one does, a person looks at it, whatever the models made of it. Second line of defence behind the prompt.
 */
const INSTRUCTION_LIKE = [
  /\bignorier(e|en)?\b.{0,40}\b(anweisungen?|regeln?|vorgaben?)\b/i,
  /\bignore (all|any|previous|the)\b/i,
  // "Buche" alone is also a wood; only "buche auf (Konto) 4900" is an instruction.
  /\b(buche|bucht|verbuche|buchen)\b.{0,20}\bauf\s+(konto\s+)?\d{4}\b/i,
  /\bkonfidenz\b/i,
  /\bconfidence\b/i,
  // "System: Lizenz Basic" is a product line; a role marker shouts or opens with an order.
  /\b(SYSTEM|ASSISTANT)\s*:/,
  /\b(system|assistant)\s*:\s*(neue|new|ignor|du |you |vergiss|forget)/i,
  /\b(disregard|forget)\b.{0,30}\b(instructions?|rules?|above)\b/i,
  /\bvergiss\b.{0,40}\b(anweisungen?|regeln?|vorgaben?)\b/i,
  // No \b around umlauts: JavaScript word boundaries only know ASCII letters.
  /(überspring|umgeh)[^.]{0,30}prüfung|prüfung[^.]{0,30}(überspring|umgeh)/i,
  /<\/?\s*(beleg|vorschlag|beispiele|lieferantenprofil|system)\b/i,
  /\b(ki|ai|llm|modell|prompt)\b.{0,40}\b(anweisungen?|testmodus)\b/i,
  /\b(ohne rückfrage|ohne prüfung)\b.{0,30}\bbuchen\b/i,
];

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_LIKE.some((pattern) => pattern.test(text));
}

export function instructionFindings(beleg: Beleg): Finding[] {
  // Every free-text field that reaches the model (see belegForPrompt), not just the obvious ones.
  const texts = [
    beleg.supplier.name,
    beleg.invoiceNumber ?? "",
    beleg.supplier.vatId ?? "",
    ...beleg.lines.map((l) => l.description),
    ...beleg.notes,
  ];
  return texts.some(looksLikeInstruction)
    ? [fehler("anweisung_im_beleg", "Der Beleg enthält Text, der wie eine Anweisung an die Buchhaltung aussieht.")]
    : [];
}

/**
 * "Diverses laut Lieferschein": the invoice names neither kind nor quantity, only a delivery note. That is enough
 * only if the note is at hand. "Kopierpapier laut Lieferschein" names the goods and is fine.
 */
const VAGUE_SUPPLY =
  /^\s*(diverses|div\.|verschiedenes|diverse artikel|waren|artikel|material(ien)?|positionen)(?=[\s,]).{0,20}\b(laut|lt\.?|gemäß|gem\.|siehe)\s+(lieferschein|ls)\b/i;
export const LIEFERSCHEIN_CODE = "leistung_nur_lieferschein";

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "fehler");
}
