/**
 * Extraction eval: the vision model reads the 20 invented PDFs in evals/pdfs/. Costs credits: only after asking.
 *
 *   pnpm eval:pdf
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { extractPdf } from "../app/lib/agents/extraktor";
import { getLiveAgentModels } from "../app/lib/agents/models";
import type { Beleg } from "../app/lib/beleg";
import { mapLimit } from "../app/lib/process.server";
import { compareExtraction, FIELDS } from "./extraction";

if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY fehlt.");
const expected = JSON.parse(readFileSync(new URL("./pdfs/erwartet.json", import.meta.url), "utf8")) as Record<
  string,
  Beleg & { kind: string }
>;
const models = getLiveAgentModels();
const results = await mapLimit(Object.entries(expected), 3, async ([id, beleg]) => {
  const pdf = readFileSync(new URL(`./pdfs/${id}.pdf`, import.meta.url));
  const out = await extractPdf(models.extraktor, new Uint8Array(pdf));
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
