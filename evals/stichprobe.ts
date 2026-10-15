/**
 * Draws 30 random eval cases (fixed seed) into evals/stichprobe.md, as a checklist for a person to confirm the
 * expected values by hand. Expectations come from templates; this is the human check on those templates.
 *
 *   pnpm tsx evals/stichprobe.ts            refuses to overwrite a list someone already worked through
 *   pnpm tsx evals/stichprobe.ts --force    starts a fresh, empty list
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import cases from "./belege.json";
import { checklistEntry, hasReviewedEntries } from "./checklist";
import type { EvalCase } from "./types";

const target = new URL("./stichprobe.md", import.meta.url);
if (!process.argv.includes("--force") && existsSync(target) && hasReviewedEntries(readFileSync(target, "utf8"))) {
  console.error("evals/stichprobe.md ist schon geprüft. Neu erzeugen löscht Haken und Notizen; dafür --force angeben.");
  process.exit(1);
}

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

writeFileSync(
  target,
  `# Stichprobe: 30 Eval-Fälle von Hand prüfen

Zufällig gezogen (fester Startwert) aus ${all.length} Fällen in \`evals/belege.json\`. Für jeden Fall: Stimmen Konto, BU-Schlüssel und das erwartete Ergebnis? Abhaken oder darunter notieren, was anders sein müsste. Erwartungswerte nie an Modellantworten anpassen.

Geprüft von: ______ am ______

${picked.map(checklistEntry).join("\n")}
`,
);
console.log(`${picked.length} Fälle nach evals/stichprobe.md geschrieben`);
