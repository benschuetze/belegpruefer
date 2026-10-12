/**
 * Extraction eval: the vision model reads the 20 invented PDFs in evals/pdfs/. Costs credits: only after asking.
 *
 *   pnpm eval:pdf --dry-run      estimate cost, no model call
 *   pnpm eval:pdf                20 vision calls, stops once --max-kosten (default 2 $) is reached
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { extractPdf } from "../app/lib/agents/extraktor";
import { getLiveAgentModels } from "../app/lib/agents/models";
import type { Beleg } from "../app/lib/beleg";
import { mapLimit } from "../app/lib/process.server";
import { compareExtraction, FIELDS } from "./extraction";

const args = process.argv.slice(2);
const maxIndex = args.indexOf("--max-kosten");
const maxCostUsd = z.coerce
  .number()
  .positive()
  .default(2)
  .parse(maxIndex >= 0 ? args[maxIndex + 1] : undefined);
const expected = JSON.parse(readFileSync(new URL("./pdfs/erwartet.json", import.meta.url), "utf8")) as Record<
  string,
  Beleg & { kind: string }
>;
// A one-page invoice is about 1,500 input tokens as PDF plus the prompt; 1,500 output tokens with thinking.
const estimatedUsd = Object.keys(expected).length * ((3000 * 2 + 1500 * 10) / 1_000_000);
console.log(`${Object.keys(expected).length} PDFs, geschätzt ${estimatedUsd.toFixed(2)} $ (Grenze ${maxCostUsd} $)`);
if (args.includes("--dry-run")) process.exit(0);
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY fehlt.");
if (estimatedUsd > maxCostUsd) throw new Error("Schätzung über der Kostengrenze.");

const models = getLiveAgentModels();
let spentMicrocents = 0;
const entries = Object.entries(expected);
const outcomes = await mapLimit(entries, 3, async ([id, beleg]) => {
  if (spentMicrocents / 1e8 > maxCostUsd) return null;
  const pdf = readFileSync(new URL(`./pdfs/${id}.pdf`, import.meta.url));
  const out = await extractPdf(models.extraktor, new Uint8Array(pdf));
  spentMicrocents += out.costMicrocents;
  return {
    id,
    kind: beleg.kind,
    fields: compareExtraction(beleg, out.beleg),
    minConfidence: out.minConfidence,
    cost: out.costMicrocents,
    ms: out.durationMs,
    error: out.error,
  };
});
const results = outcomes.filter((r): r is NonNullable<typeof r> => r !== null);
if (results.length < entries.length)
  console.error(`Kostengrenze erreicht: ${entries.length - results.length} PDFs nicht gelesen.`);
const perField = Object.fromEntries(FIELDS.map((f) => [f, results.filter((r) => r.fields[f]).length / results.length]));
const allRight = results.filter((r) => Object.values(r.fields).every(Boolean)).length;
const summary = {
  model: models.extraktor.id,
  documents: results.length,
  allFieldsRight: allRight,
  perField,
  costCentsPerDoc: results.reduce((s, r) => s + r.cost, 0) / results.length / 1_000_000,
  secondsPerDoc: results.reduce((s, r) => s + r.ms, 0) / results.length / 1000,
  misses: results
    .filter((r) => !Object.values(r.fields).every(Boolean))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      wrong: FIELDS.filter((f) => !r.fields[f]),
      minConfidence: r.minConfidence,
      error: r.error,
    })),
};
const file = new URL("./ergebnis.json", import.meta.url);
const current = JSON.parse(readFileSync(file, "utf8"));
writeFileSync(file, `${JSON.stringify({ ...current, extraction: summary }, null, 1)}\n`);
console.log(JSON.stringify(summary, null, 1));
