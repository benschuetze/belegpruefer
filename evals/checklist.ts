import { accountLabel } from "../app/lib/skr03";
import type { EvalCase } from "./types";

const euro = (cents: number) => `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`;

/** One checklist entry: what was bought, what is expected, and why, so a person can confirm it by hand. */
export function checklistEntry(c: EvalCase): string {
  const b = c.beleg;
  const items = b.lines.map((l) => `${l.description} (${l.taxRate} %, ${euro(l.netCents)} netto)`).join("; ");
  // Missing mandatory fields often decide "pruefen"; without them in the list a reviewer cannot judge the case.
  // Same rule as the validator: a recipient without a name counts as missing.
  const missing = [!b.invoiceNumber && "Rechnungsnummer", !b.buyer?.name && "Empfänger"].filter(Boolean);
  const gaps = missing.length ? ` **Ohne ${missing.join(" und ")}.**` : "";
  const expected = c.expected.lines
    .map((l) => `${l.satz} %: ${accountLabel(l.konto)}, BU ${l.bu || "leer"}`)
    .join(" · ");
  return `- [ ] **${c.id}** ${c.tenantName} ← ${b.supplier.name} (${b.supplier.country ?? "DE"}): ${items}. Brutto ${euro(b.totals.grossCents)}.${gaps}${b.notes.length ? ` Hinweise: ${b.notes.join(" / ")}.` : ""}\n  Erwartet: ${expected} → **${c.expected.outcome}**${c.note ? `\n  Notiz: ${c.note}` : ""}`;
}

/** A ticked box or a reviewer's note means a person already worked through the file. */
export function hasReviewedEntries(markdown: string): boolean {
  return /^- \[x\]/m.test(markdown) || /^\s+(Frage|Einwand|Antwort):/m.test(markdown);
}
