/**
 * The small SKR03 excerpt the app books into. Numbers and names follow the DATEV chart of accounts SKR03;
 * entries marked `checkBeforeUse` are a working assumption that has not been confirmed against the official list yet.
 */
export type Account = {
  number: string;
  name: string;
  /** Booked automatically only above the higher confidence threshold (Bewirtung, GWG). */
  risk?: boolean;
  /** Fixed asset: never booked automatically, always a person decides (depreciation over years). */
  asset?: boolean;
  checkBeforeUse?: boolean;
};

export const EXPENSE_ACCOUNTS = [
  { number: "3400", name: "Wareneingang 19 % Vorsteuer" },
  { number: "3300", name: "Wareneingang 7 % Vorsteuer" },
  { number: "4210", name: "Miete" },
  { number: "4360", name: "Versicherungen" },
  { number: "4600", name: "Werbekosten" },
  { number: "4650", name: "Bewirtungskosten", risk: true },
  { number: "4670", name: "Reisekosten Unternehmer" },
  { number: "4806", name: "Wartungskosten für Hard- und Software" },
  { number: "4855", name: "Sofortabschreibung geringwertiger Wirtschaftsgüter", risk: true },
  { number: "4920", name: "Telefon" },
  { number: "4925", name: "Internet" },
  { number: "4930", name: "Bürobedarf" },
  { number: "4940", name: "Zeitschriften, Bücher" },
  { number: "4950", name: "Rechts- und Beratungskosten" },
  {
    number: "4964",
    name: "Aufwendungen für die zeitlich befristete Überlassung von Rechten (Lizenzen, Software-Abos)",
  },
  { number: "4970", name: "Nebenkosten des Geldverkehrs" },
  { number: "4900", name: "Sonstige betriebliche Aufwendungen" },
  { number: "0420", name: "Büroeinrichtung (Anlagevermögen)", asset: true, checkBeforeUse: true },
] as const satisfies readonly Account[];

export type AccountNumber = (typeof EXPENSE_ACCOUNTS)[number]["number"];

export const ACCOUNT_NUMBERS = EXPENSE_ACCOUNTS.map((a) => a.number) as [AccountNumber, ...AccountNumber[]];

/** Creditor side of every incoming invoice; payment later moves it to the bank (1200), which is out of scope. */
export const CONTRA_ACCOUNT = "1600";
export const BANK_ACCOUNT = "1200";

export function accountByNumber(number: string): Account | undefined {
  return EXPENSE_ACCOUNTS.find((a) => a.number === number);
}

export function accountLabel(number: string): string {
  const account = accountByNumber(number);
  return account ? `${account.number} ${account.name}` : number;
}

/**
 * DATEV tax keys (BU-Schlüssel) for input tax. 46 for services from another EU country under § 13b (1) UStG is a
 * working assumption: sources disagree, and DATEV can map keys per client. See README, "Fachlich offen".
 */
export const TAX_KEYS = {
  "9": { label: "19 % Vorsteuer", rate: 19 },
  "8": { label: "7 % Vorsteuer", rate: 7 },
  "46": { label: "Reverse Charge, sonstige Leistung EU (§ 13b UStG), 19 %", rate: 0, checkBeforeUse: true },
  "": { label: "ohne Steuerschlüssel", rate: 0 },
} as const;

export type TaxKey = keyof typeof TAX_KEYS;
export const TAX_KEY_VALUES = Object.keys(TAX_KEYS) as [TaxKey, ...TaxKey[]];
export const REVERSE_CHARGE_KEY: TaxKey = "46";

/** The tax key that goes with an ordinary German invoice at this rate. */
export function taxKeyForRate(rate: number): TaxKey {
  if (rate === 19) return "9";
  if (rate === 7) return "8";
  return "";
}

/** § 6 (2) EStG: net up to 800 € per item may be written off at once. */
export const GWG_LIMIT_NET_CENTS = 80_000;
/** § 33 UStDV: invoices up to 250 € gross need fewer mandatory fields. */
export const SMALL_INVOICE_LIMIT_GROSS_CENTS = 25_000;
