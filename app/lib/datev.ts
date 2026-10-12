import type { Booking, Tenant } from "~/lib/db/schema";
import { formatDatevAmount } from "~/lib/money";

/**
 * DATEV "Buchungsstapel" (EXTF format 700, category 21, version 13): semicolon separated, decimal comma,
 * Windows-1252. Line 1 is the header, line 2 the column names, then one line per booking.
 * Only the first 14 columns are filled; DATEV accepts shorter lines. Checked against the public descriptions of
 * the format; the full official interface description needs a DATEV login (see README, "Fachlich offen").
 */
export const COLUMNS = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Kurs",
  "Basis-Umsatz",
  "WKZ Basis-Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Belegfeld 2",
  "Skonto",
  "Buchungstext",
];

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** yyyy-mm-dd → TTMM; the year comes from the header's period. */
export function datevDate(iso: string): string {
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}`;
}

/** Belegfeld 1 allows letters, digits and $ & % * + - / up to 36 characters. */
export function belegfeld(value: string): string {
  return value.replace(/[^A-Za-z0-9$&%*+\-/]/g, "").slice(0, 36);
}

/**
 * Up to 60 characters, one line. A leading = + @ (and - before a letter) is removed: the text comes from the invoice, and a spreadsheet
 * opening the export would run "=HYPERLINK(…)" as a formula. DATEV itself does not care.
 */
export function buchungstext(value: string): string {
  return (
    value
      .replace(/[\r\n\t]+/g, " ")
      .trim()
      // "-5 % Rabatt" stays: a minus before a digit or space is text, "-cmd|…" is not.
      .replace(/^(?:[=+@]|-(?=[^\d\s]))+/, "")
      .trim()
      .slice(0, 60)
  );
}

/** First day of the fiscal year a date belongs to, for fiscal years starting in any month. */
export function fiscalYearStart(date: string, startMonth: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  return `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
}

/** The batch carries dates as TTMM; the year comes from the header, so a batch never spans two fiscal years. */
export function sameFiscalYear(from: string, to: string, startMonth: number): boolean {
  return fiscalYearStart(from, startMonth) === fiscalYearStart(to, startMonth);
}

type Options = {
  tenant: Tenant;
  from: string;
  to: string;
  createdAt: Date;
  /**
   * Header field "Festschreibung". The app has already locked the period; 0 still lets the accountant correct in
   * DATEV after import, which is what an advisory firm expects from a client's pre-booking.
   */
  lockInDatev?: boolean;
};

export function buildBuchungsstapel(
  bookings: Booking[],
  { tenant, from, to, createdAt, lockInDatev = false }: Options,
): string {
  if (!sameFiscalYear(from, to, tenant.fiscalYearStartMonth)) {
    throw new RangeError("Ein Buchungsstapel darf nicht über zwei Wirtschaftsjahre gehen.");
  }
  const fiscalYear = fiscalYearStart(from, tenant.fiscalYearStartMonth).replaceAll("-", "");
  const stamp = createdAt
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 17);
  const header = [
    quote("EXTF"),
    "700",
    "21",
    quote("Buchungsstapel"),
    "13",
    stamp,
    "",
    quote("RE"),
    quote(""),
    quote(""),
    String(tenant.beraterNr),
    String(tenant.mandantenNr),
    fiscalYear,
    "4",
    from.replaceAll("-", ""),
    to.replaceAll("-", ""),
    quote(buchungstext(`Eingangsrechnungen ${from} bis ${to}`).slice(0, 30)),
    quote(""),
    "1",
    "0",
    lockInDatev ? "1" : "0",
    quote("EUR"),
    "",
    quote(""),
    "",
    "",
    quote("03"),
    "",
    "",
    quote(""),
    quote(""),
  ].join(";");

  const lines = bookings.map((b) =>
    [
      formatDatevAmount(b.amountCents),
      // Expense on the debit side; a reversal (negative amount) goes to the credit side.
      quote(b.amountCents < 0 ? "H" : "S"),
      quote("EUR"),
      "",
      "",
      quote(""),
      b.account,
      b.contraAccount,
      quote(b.taxKey),
      datevDate(b.bookingDate),
      quote(belegfeld(b.reference)),
      quote(""),
      "",
      quote(buchungstext(b.text)),
    ].join(";"),
  );
  return `${[header, COLUMNS.join(";"), ...lines].join("\r\n")}\r\n`;
}

const CP1252: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  "„": 0x84,
  "…": 0x85,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "–": 0x96,
  "—": 0x97,
  "™": 0x99,
};

/** Windows-1252, which DATEV expects. Characters it cannot hold become "?" rather than breaking the file. */
export function toWindows1252(text: string): Buffer {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else bytes.push(CP1252[char] ?? 0x3f);
  }
  return Buffer.from(bytes);
}

export function exportFilename(tenant: Tenant, from: string, to: string): string {
  return `EXTF_Buchungsstapel_${tenant.mandantenNr}_${from.replaceAll("-", "")}_${to.replaceAll("-", "")}.csv`;
}
