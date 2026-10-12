import type { BookingLine, KontiererOutput } from "~/lib/agents/kontierer";
import { coversTaxGroups } from "~/lib/agents/kontierer";
import type { PrueferOutput } from "~/lib/agents/pruefer";
import { type Beleg, isForeignEu, mentionsReverseCharge } from "~/lib/beleg";
import type { Finding } from "~/lib/db/schema";
import { accountByNumber, REVERSE_CHARGE_KEY, taxKeyForRate } from "~/lib/skr03";
import { hasErrors, validateBooking } from "~/lib/validator";

/** Start values from the briefing; `evals/` measures where they should be and the README explains the choice. */
export const DEFAULT_THRESHOLDS = { normal: 0.8, risk: 0.9 };
export type Thresholds = typeof DEFAULT_THRESHOLDS;

export type DecisionInput = {
  beleg: Beleg;
  findings: Finding[];
  /** null: the booker gave no usable answer (error, bad JSON, unknown account). */
  kontierer: KontiererOutput | null;
  /** undefined: no reviewer in this setup (eval variant 1). null: the reviewer was asked and gave no usable answer. */
  pruefer?: PrueferOutput | null;
  thresholds?: Thresholds;
};

export type Outcome = {
  outcome: "automatisch" | "pruefen";
  /** Every reason that applies, not just the first, so the review screen can show all of them. */
  reasons: string[];
  /** Findings that depend on the chosen accounts (Bewirtung, GWG), to be stored with the document. */
  bookingFindings: Finding[];
  threshold: number | null;
};

export function isRiskLine(line: BookingLine): boolean {
  return Boolean(accountByNumber(line.konto)?.risk) || line.buSchluessel === REVERSE_CHARGE_KEY;
}

/** Tax key and rate must fit together and fit the document; the model's word is not enough for that. */
function taxKeyProblem(beleg: Beleg, line: BookingLine): string | null {
  if (line.satz > 0) {
    return line.buSchluessel === taxKeyForRate(line.satz)
      ? null
      : `BU-Schlüssel ${line.buSchluessel || "leer"} passt nicht zu ${line.satz} %`;
  }
  if (line.buSchluessel === REVERSE_CHARGE_KEY) {
    return isForeignEu(beleg) && mentionsReverseCharge(beleg)
      ? null
      : "Reverse Charge, aber kein EU-Lieferant mit Hinweis auf Steuerschuldnerschaft";
  }
  if (line.buSchluessel !== "") return `BU-Schlüssel ${line.buSchluessel} bei 0 % ohne Reverse Charge`;
  return isForeignEu(beleg) && mentionsReverseCharge(beleg) ? "Reverse-Charge-Rechnung ohne BU-Schlüssel 46" : null;
}

/** Code, not a model, decides whether a booking goes through on its own. */
export function decide(input: DecisionInput): Outcome {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const reasons: string[] = [];
  const bookingFindings: Finding[] = [];

  if (hasErrors(input.findings)) reasons.push("Der Validator hat Fehler auf dem Beleg gefunden.");

  const proposal = input.kontierer;
  if (!proposal) {
    reasons.push("Der Kontierer hat keine verwertbare Antwort gegeben.");
    return { outcome: "pruefen", reasons, bookingFindings, threshold: null };
  }
  if (!coversTaxGroups(input.beleg, proposal.zeilen)) {
    reasons.push("Der Vorschlag deckt nicht genau die Steuersätze des Belegs ab.");
  }
  for (const line of proposal.zeilen) {
    const problem = taxKeyProblem(input.beleg, line);
    if (problem) reasons.push(problem);
    if (accountByNumber(line.konto)?.asset) {
      reasons.push(`Konto ${line.konto} ist Anlagevermögen: Abschreibung entscheidet ein Mensch.`);
    }
    for (const finding of validateBooking(input.beleg, line.konto)) {
      if (!bookingFindings.some((f) => f.code === finding.code)) bookingFindings.push(finding);
    }
  }
  if (hasErrors(bookingFindings)) reasons.push("Für das gewählte Konto fehlen Angaben auf dem Beleg.");

  if (input.pruefer === null) reasons.push("Der Prüfer hat keine verwertbare Antwort gegeben.");
  if (input.pruefer?.urteil === "einwand") reasons.push("Der Prüfer hat einen Einwand.");

  const risky = proposal.zeilen.some(isRiskLine);
  const threshold = risky ? thresholds.risk : thresholds.normal;
  if (proposal.konfidenz < threshold) {
    reasons.push(
      `Konfidenz ${proposal.konfidenz.toFixed(2)} liegt unter der Schwelle ${threshold.toFixed(2)}${risky ? " für Risikokonten" : ""}.`,
    );
  }
  return { outcome: reasons.length === 0 ? "automatisch" : "pruefen", reasons, bookingFindings, threshold };
}
