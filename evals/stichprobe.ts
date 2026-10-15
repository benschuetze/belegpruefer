/**
 * Draws 30 random eval cases (fixed seed) into evals/stichprobe.md, as a checklist for a person to confirm the
 * expected values by hand. Expectations come from templates; this is the human check on those templates.
 *
 *   pnpm tsx evals/stichprobe.ts
 */
import { writeFileSync } from "node:fs";
import { accountLabel } from "../app/lib/skr03";
import cases from "./belege.json";
import type { EvalCase } from "./types";

const all = cases as EvalCase[];
let seed = 30;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const picked = [...all]
  .map((c) => ({ c, r: random() }))
  .sort((a, b) => a.r - b.r)
  .slice(0, 30)
  .map(({ c }) => c)
  .sort((a, b) => a.id.localeCompare(b.id));

const euro = (cents: number) => `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`;
const lines = picked.map((c) => {
  const b = c.beleg;
  const items = b.lines.map((l) => `${l.description} (${l.taxRate} %, ${euro(l.netCents)} netto)`).join("; ");
  // Missing mandatory fields often decide "pruefen"; without them in the list a reviewer cannot judge the case.
  const missing = [!b.invoiceNumber && "Rechnungsnummer", !b.buyer?.name && "Empfänger"].filter(Boolean);
  const gaps = missing.length ? ` **Ohne ${missing.join(" und ")}.**` : "";
  const expected = c.expected.lines
    .map((l) => `${l.satz} %: ${accountLabel(l.konto)}, BU ${l.bu || "leer"}`)
    .join(" · ");
  return `- [ ] **${c.id}** ${c.tenantName} ← ${b.supplier.name} (${b.supplier.country ?? "DE"}): ${items}. Brutto ${euro(b.totals.grossCents)}.${gaps}${b.notes.length ? ` Hinweise: ${b.notes.join(" / ")}.` : ""}\n  Erwartet: ${expected} → **${c.expected.outcome}**${c.expected.flexible ? " (automatisch mit richtigem Konto auch ok)" : ""}${c.note ? `\n  Notiz: ${c.note}` : ""}`;
});

writeFileSync(
  new URL("./stichprobe.md", import.meta.url),
  `# Stichprobe: 30 Eval-Fälle von Hand prüfen

Zufällig gezogen (fester Startwert) aus ${all.length} Fällen in \`evals/belege.json\`. Für jeden Fall: Stimmen Konto, BU-Schlüssel und das erwartete Ergebnis? Abhaken oder darunter notieren, was anders sein müsste. Erwartungswerte nie an Modellantworten anpassen.

Geprüft von: ______ am ______

${lines.join("\n")}
`,
);
console.log(`${picked.length} Fälle nach evals/stichprobe.md geschrieben`);
