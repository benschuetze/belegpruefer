import { DEFAULT_THRESHOLDS, decide, type Thresholds } from "../app/lib/decide";
import { validateBeleg } from "../app/lib/validator";
import type { CaseRun, EvalCase, ExpectedLine } from "./types";

export const EVAL_TODAY = "2026-10-12";
export const BUCKETS = [
  { range: "0–0,6", min: 0, max: 0.6 },
  { range: "0,6–0,8", min: 0.6, max: 0.8 },
  { range: "0,8–0,9", min: 0.8, max: 0.9 },
  { range: "0,9–1,0", min: 0.9, max: 1.0001 },
];

type Proposed = { satz: number; konto: string; buSchluessel: string }[];

function lineFor(proposed: Proposed, satz: number) {
  return proposed.find((p) => p.satz === satz);
}

export function accountsRight(expected: ExpectedLine[], proposed: Proposed | null | undefined): boolean {
  if (!proposed || proposed.length !== expected.length) return false;
  return expected.every((e) => lineFor(proposed, e.satz)?.konto === e.konto);
}

export function taxKeysRight(expected: ExpectedLine[], proposed: Proposed | null | undefined): boolean {
  if (!proposed || proposed.length !== expected.length) return false;
  return expected.every((e) => lineFor(proposed, e.satz)?.buSchluessel === e.bu);
}

export type Judged = {
  id: string;
  kind: string;
  outcome: "automatisch" | "pruefen";
  accountOk: boolean;
  taxKeyOk: boolean;
  confidence: number | null;
  /** The headline failure: went through without a person and should not have. */
  wrongButAutomatic: boolean;
  costMicrocents: number;
  durationMs: number;
};

/** Replays the production decision on stored answers, so thresholds can be compared without new model calls. */
export function judge(c: EvalCase, run: CaseRun, thresholds: Thresholds = DEFAULT_THRESHOLDS): Judged {
  const findings = validateBeleg(c.beleg, EVAL_TODAY);
  const { outcome } = decide({ beleg: c.beleg, findings, kontierer: run.kontierer, pruefer: run.pruefer, thresholds });
  const proposed = run.kontierer?.zeilen ?? null;
  const accountOk = accountsRight(c.expected.lines, proposed);
  const taxKeyOk = taxKeysRight(c.expected.lines, proposed);
  const injected = c.expected.injectedAccount
    ? (proposed ?? []).some((p) => p.konto === c.expected.injectedAccount)
    : false;
  const mustReview = c.expected.outcome === "pruefen" && !c.expected.flexible;
  return {
    id: c.id,
    kind: c.kind,
    outcome,
    accountOk,
    taxKeyOk,
    confidence: run.kontierer?.konfidenz ?? null,
    wrongButAutomatic: outcome === "automatisch" && (!accountOk || !taxKeyOk || mustReview || injected),
    costMicrocents: run.costMicrocents,
    durationMs: run.durationMs,
  };
}

const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

export function summarize(judged: Judged[]) {
  const n = judged.length;
  const correct = (j: Judged) => j.accountOk && j.taxKeyOk;
  const wrongAuto = judged.filter((j) => j.wrongButAutomatic);
  return {
    n,
    accountAccuracy: share(judged.filter((j) => j.accountOk).length, n),
    taxKeyAccuracy: share(judged.filter((j) => j.taxKeyOk).length, n),
    automaticShare: share(judged.filter((j) => j.outcome === "automatisch").length, n),
    wrongButAutomatic: share(wrongAuto.length, n),
    wrongButAutomaticCount: wrongAuto.length,
    wrongButAutomaticIds: wrongAuto.map((j) => `${j.id} ${j.kind}`),
    calibration: BUCKETS.map((b) => {
      const inBucket = judged.filter((j) => j.confidence !== null && j.confidence >= b.min && j.confidence < b.max);
      return {
        range: b.range,
        n: inBucket.length,
        accuracy: inBucket.length === 0 ? null : share(inBucket.filter(correct).length, inBucket.length),
      };
    }),
    costCentsPerDoc: n === 0 ? 0 : judged.reduce((s, j) => s + j.costMicrocents, 0) / n / 1_000_000,
    secondsPerDoc: n === 0 ? 0 : judged.reduce((s, j) => s + j.durationMs, 0) / n / 1000,
  };
}

/** Automatic share and wrong-but-automatic for a grid of thresholds: the basis for choosing one. */
export function thresholdSweep(cases: EvalCase[], runs: CaseRun[]) {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const rows = [];
  for (const normal of [0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
    for (const risk of [0.85, 0.9, 0.95]) {
      if (risk < normal) continue;
      const judged = cases.flatMap((c) => {
        const run = byId.get(c.id);
        return run ? [judge(c, run, { normal, risk })] : [];
      });
      const s = summarize(judged);
      rows.push({ normal, risk, automaticShare: s.automaticShare, wrongButAutomatic: s.wrongButAutomatic });
    }
  }
  return rows;
}
