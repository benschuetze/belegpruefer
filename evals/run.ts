/**
 * Ablation eval against the real model. Costs credits: run only after asking.
 *
 *   pnpm eval --dry-run              estimate calls and cost, no model call
 *   pnpm eval                        all four variants on all cases
 *   pnpm eval --variante 4 --limit 30
 *   pnpm eval --nur-auswerten        recompute evals/ergebnis.json from the stored runs
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { Example } from "../app/lib/agents/kontierer";
import { kontiererMessages } from "../app/lib/agents/kontierer";
import { DEFAULT_MODEL_IDS, getLiveAgentModels } from "../app/lib/agents/models";
import { KONTIERER_SYSTEM, PROMPT_VERSIONS, PRUEFER_SYSTEM, RECHERCHE_SYSTEM } from "../app/lib/agents/prompts";
import { DEFAULT_THRESHOLDS } from "../app/lib/decide";
import { mapLimit } from "../app/lib/process.server";
import { runTeam, unknownSupplier } from "../app/lib/team";
import { vatIdFormatValid } from "../app/lib/validator";
import cases from "./belege.json";
import { judge, summarize, thresholdSweep } from "./score";
import { type CaseRun, type EvalCase, VARIANTS, type VariantId } from "./types";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const all = cases as EvalCase[];
const options = z
  .object({
    limit: z.coerce.number().int().positive().default(all.length),
    variants: z
      .array(z.enum(["1", "2", "3", "4"]))
      .min(1)
      .default(["1", "2", "3", "4"]),
    maxCostUsd: z.coerce.number().positive().default(15),
  })
  .parse({
    limit: value("--limit"),
    variants: value("--variante")?.split(","),
    maxCostUsd: value("--max-kosten"),
  });
const selected = all.slice(0, options.limit);
const variants: VariantId[] = options.variants;
const maxCostUsd = options.maxCostUsd;
/** Across all variants of this run: the limit is for the whole bill, not per variant. */
let spentMicrocents = 0;
const RUNS_DIR = new URL("./runs/", import.meta.url);

/**
 * History as production would have it: earlier invoices of the same tenant and supplier, with the booking a person
 * confirmed (the expected values). Only earlier ones, so no case sees its own answer.
 */
function historyFor(index: number): Example[] {
  const c = all[index];
  if (!c) return [];
  return all
    .slice(0, index)
    .filter((o) => o.tenant === c.tenant && o.beleg.supplier.name === c.beleg.supplier.name)
    .reverse()
    .map((o) => ({
      lieferant: o.beleg.supplier.name,
      positionen: o.beleg.lines.map((l) => l.description).slice(0, 5),
      konto: o.expected.lines[0]?.konto ?? "",
      buSchluessel: o.expected.lines[0]?.bu ?? "",
    }));
}

function estimate() {
  // About 3.5 characters per token for German prompts with JSON.
  const tokens = (text: string) => Math.ceil(text.length / 3.5);
  const price = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10] } as Record<string, [number, number]>;
  const cost = (model: string, input: number, output: number) => {
    const [i, o] = price[model] ?? [4, 20];
    return (input * i + output * o) / 1_000_000;
  };
  let total = 0;
  for (const v of variants) {
    const team = VARIANTS[v];
    let usd = 0;
    let calls = 0;
    selected.forEach((c, index) => {
      const history = historyFor(all.indexOf(c));
      const user = kontiererMessages({
        beleg: c.beleg,
        tenantName: c.tenantName,
        examples: team.examples ? history.slice(0, 5) : [],
        profile: null,
      })[0]?.content;
      const input = tokens(KONTIERER_SYSTEM) + tokens(user ?? "");
      // Adaptive thinking at effort "low" adds output; 600 tokens is a deliberately generous guess.
      usd += cost(DEFAULT_MODEL_IDS.kontierer, input, 600);
      calls++;
      if (team.pruefer) {
        usd += cost(DEFAULT_MODEL_IDS.pruefer, tokens(PRUEFER_SYSTEM) + tokens(user ?? "") + 200, 700);
        calls++;
      }
      if (team.recherche && unknownSupplier(null, history)) {
        usd += cost(DEFAULT_MODEL_IDS.recherche, 3 * (tokens(RECHERCHE_SYSTEM) + 400), 900);
        calls++;
      }
      void index;
    });
    total += usd;
    console.log(`Variante ${v} (${team.label}): ${calls} Aufrufe, geschätzt ${usd.toFixed(2)} $`);
  }
  console.log(`Gesamt geschätzt: ${total.toFixed(2)} $ für ${selected.length} Belege`);
  return total;
}

async function runVariant(v: VariantId): Promise<CaseRun[]> {
  const models = getLiveAgentModels();
  const team = VARIANTS[v];
  let done = 0;
  // Past the cost limit the remaining cases are skipped, not thrown away: what was paid for gets written.
  const runs = await mapLimit(selected, 3, async (c): Promise<CaseRun | null> => {
    if (spentMicrocents / 1e8 > maxCostUsd) return null;
    const history = historyFor(all.indexOf(c));
    const started = Date.now();
    const result = await runTeam({
      models,
      beleg: c.beleg,
      tenantName: c.tenantName,
      history,
      knownProfile: null,
      team,
      research: {
        // Offline stand-in for VIES: the invented ids would all be unknown there. Format decides.
        viesCheck: async (id) => ({ valid: vatIdFormatValid(id) }),
        supplierHistory: async () =>
          history.map((h) => ({ lieferant: h.lieferant, konto: h.konto, text: h.positionen.join(", ") })),
      },
    });
    const cost = result.steps.reduce((s, step) => s + (step.costMicrocents ?? 0), 0);
    spentMicrocents += cost;
    done++;
    if (done % 10 === 0)
      console.error(`  Variante ${v}: ${done}/${selected.length}, bisher ${(spentMicrocents / 1e8).toFixed(2)} $`);
    return {
      id: c.id,
      kontierer: result.kontierer,
      ...(team.pruefer ? { pruefer: result.pruefer ?? null } : {}),
      researched: result.researched,
      examples: team.examples ? Math.min(5, history.length) : 0,
      costMicrocents: cost,
      durationMs: Date.now() - started,
      errors: result.steps
        .map((s) => (s.output as { error?: string } | null)?.error)
        .filter((e): e is string => Boolean(e)),
    };
  });
  const finished = runs.filter((r): r is CaseRun => r !== null);
  if (finished.length < selected.length) {
    console.error(
      `  Kostengrenze ${maxCostUsd} $ erreicht: ${selected.length - finished.length} Belege nicht gemessen.`,
    );
  }
  return finished;
}

function writeResult(runsByVariant: Partial<Record<VariantId, CaseRun[]>>, measuredAt: string) {
  const variantsOut = (Object.keys(runsByVariant) as VariantId[]).sort().map((v) => {
    const runs = runsByVariant[v] ?? [];
    const byId = new Map(runs.map((r) => [r.id, r]));
    const judged = all.filter((c) => byId.has(c.id)).map((c) => judge(c, byId.get(c.id) as CaseRun));
    const kinds = [...new Set(judged.map((j) => j.kind))];
    return {
      id: v,
      label: VARIANTS[v].label,
      ...summarize(judged),
      errors: runs.reduce((s, r) => s + r.errors.length, 0),
      byKind: kinds.map((kind) => {
        const s = summarize(judged.filter((j) => j.kind === kind));
        return {
          kind,
          n: s.n,
          accountAccuracy: s.accountAccuracy,
          automaticShare: s.automaticShare,
          wrongButAutomaticCount: s.wrongButAutomaticCount,
        };
      }),
    };
  });
  const last = (Object.keys(runsByVariant) as VariantId[]).sort().at(-1);
  const result = {
    measuredAt,
    cases: Math.max(...variantsOut.map((v) => v.n)),
    models: Object.fromEntries(Object.entries(DEFAULT_MODEL_IDS).filter(([role]) => role !== "extraktor")),
    promptVersions: PROMPT_VERSIONS,
    thresholdsUsed: DEFAULT_THRESHOLDS,
    variants: variantsOut,
    sweep: last ? thresholdSweep(all, runsByVariant[last] ?? []) : [],
  };
  // Keep what other runners wrote (the extraction eval), replace only the ablation part.
  const file = new URL("./ergebnis.json", import.meta.url);
  const previous = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  // Re-scoring stored answers is not a new measurement: the date stays the one of the model run.
  const merged =
    flag("--nur-auswerten") && previous.measuredAt ? { ...result, measuredAt: previous.measuredAt } : result;
  writeFileSync(file, `${JSON.stringify({ ...previous, ...merged }, null, 1)}\n`);
  return result;
}

function printTable(result: ReturnType<typeof writeResult>) {
  const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
  console.log(`\n| Aufstellung | Konto | BU | automatisch | falsch trotz automatisch | Kosten/Beleg | Zeit/Beleg |`);
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  for (const v of result.variants) {
    console.log(
      `| ${v.label} | ${pct(v.accountAccuracy)} | ${pct(v.taxKeyAccuracy)} | ${pct(v.automaticShare)} | ${pct(v.wrongButAutomatic)} (${v.wrongButAutomaticCount}) | ${v.costCentsPerDoc.toFixed(3)} ct | ${v.secondsPerDoc.toFixed(1)} s |`,
    );
  }
}

if (flag("--dry-run")) {
  estimate();
  process.exit(0);
}

mkdirSync(RUNS_DIR, { recursive: true });
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const runsByVariant: Partial<Record<VariantId, CaseRun[]>> = {};

if (flag("--nur-auswerten")) {
  for (const v of variants) {
    try {
      runsByVariant[v] = JSON.parse(readFileSync(new URL(`./runs/variante-${v}.json`, import.meta.url), "utf8"));
    } catch {
      // Not measured yet.
    }
  }
} else {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY fehlt: pnpm eval braucht das echte Modell.");
  const estimated = estimate();
  if (estimated > maxCostUsd) throw new Error(`Schätzung ${estimated.toFixed(2)} $ über --max-kosten ${maxCostUsd} $.`);
  for (const v of variants) {
    console.error(`Variante ${v}: ${VARIANTS[v].label}`);
    runsByVariant[v] = await runVariant(v);
    writeFileSync(
      new URL(`./runs/variante-${v}.json`, import.meta.url),
      `${JSON.stringify(runsByVariant[v], null, 1)}\n`,
    );
  }
}
if (Object.values(runsByVariant).every((r) => !r || r.length === 0)) {
  console.error("Keine gemessenen Läufe: evals/ergebnis.json bleibt unverändert.");
  process.exit(1);
}
const result = writeResult(runsByVariant, today);
printTable(result);
