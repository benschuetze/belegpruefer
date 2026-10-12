// Amounts are integer cents end to end. Parsing goes through strings so no float ever touches a total.

const GERMAN_AMOUNT = /^([+-])?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

export function parseGermanAmount(input: string): number {
  const trimmed = input.trim().replace(/\s*(?:€|EUR)$/i, "");
  const match = GERMAN_AMOUNT.exec(trimmed);
  if (!match) {
    throw new Error(`Ungültiger Betrag: "${input}"`);
  }
  const [, sign, intPart = "", fraction = ""] = match;
  const cents = Number.parseInt(intPart.replaceAll(".", ""), 10) * 100 + Number.parseInt(fraction.padEnd(2, "0"), 10);
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`Betrag zu groß: "${input}"`);
  }
  return sign === "-" ? -cents : cents;
}

export function formatCents(cents: number, currency = "EUR"): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const euros = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const rest = (abs % 100).toString().padStart(2, "0");
  const symbol = currency === "EUR" ? "€" : currency;
  return `${negative ? "−" : ""}${euros},${rest} ${symbol}`;
}

const GERMAN_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/;

/** dd.mm.yyyy or dd.mm.yy → yyyy-mm-dd. Two-digit years are read as 20yy, bank exports never reach back further. */
export function parseGermanDate(input: string): string {
  const match = GERMAN_DATE.exec(input.trim());
  if (!match) {
    throw new Error(`Ungültiges Datum: "${input}"`);
  }
  const [, d = "", m = "", y = ""] = match;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const month = Number(m);
  const day = Number(d);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Ungültiges Datum: "${input}"`);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

const DECIMAL = /^([+-])?(\d+)(?:\.(\d{1,2}))?$/;

/**
 * XML invoice amounts ("119.00", "-5.5", "42"). More than two decimals is an error, not a rounding:
 * a line total of 10.005 means the invoice itself is wrong, and the validator must get to say so.
 */
export function parseDecimalCents(input: string): number {
  const match = DECIMAL.exec(input.trim());
  if (!match) throw new Error(`Ungültiger Betrag: "${input}"`);
  const [, sign, intPart = "", fraction = ""] = match;
  const cents = Number.parseInt(intPart, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0"), 10);
  if (!Number.isSafeInteger(cents)) throw new Error(`Betrag zu groß: "${input}"`);
  return sign === "-" ? -cents : cents;
}

/** Tax on a net amount at a whole-percent rate, rounded half away from zero to the cent (the usual commercial rule). */
export function taxOf(netCents: number, ratePercent: number): number {
  const scaled = netCents * ratePercent;
  const sign = scaled < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(scaled) + 50) / 100);
}

/** DATEV wants the amount without sign and with a decimal comma: 1234,56. Direction goes into Soll/Haben. */
export function formatDatevAmount(cents: number): string {
  const abs = Math.abs(cents);
  return `${Math.trunc(abs / 100)},${(abs % 100).toString().padStart(2, "0")}`;
}
