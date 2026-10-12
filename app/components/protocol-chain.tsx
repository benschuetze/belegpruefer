import type { Decision } from "~/lib/db/schema";

const ROLE_LABEL: Record<string, string> = {
  parser: "Parser",
  extraktor: "Extraktor",
  validator: "Validator",
  recherche: "Recherche",
  kontierer: "Kontierer",
  pruefer: "Prüfer",
  entscheidung: "Entscheidung",
};

/** Cost in cents with enough decimals to tell a cheap call from a free one. */
export function formatCost(microcents: number): string {
  if (microcents === 0) return "0 ct";
  return `${(microcents / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 4 })} ct`;
}

function summary(step: Pick<Decision, "role" | "output">): string {
  const out = step.output as Record<string, unknown> | null;
  if (!out) return "";
  if ("error" in out && out.error) return `keine verwertbare Antwort (${String(out.error).slice(0, 80)})`;
  switch (step.role) {
    case "parser":
      return "reason" in out ? `abgelehnt: ${String(out.reason)}` : `gelesen als ${String(out.profile)}`;
    case "validator": {
      const findings = (step.output as { severity: string }[]) ?? [];
      const errors = findings.filter((f) => f.severity === "fehler").length;
      return findings.length === 0 ? "keine Befunde" : `${errors} Fehler, ${findings.length - errors} Hinweise`;
    }
    case "recherche":
      return String(out.zusammenfassung ?? "");
    case "kontierer":
      return ((out.zeilen as { konto: string; buSchluessel: string }[]) ?? [])
        .map((z) => `${z.konto} / BU ${z.buSchluessel || "–"}`)
        .join(", ");
    case "pruefer":
      return out.urteil === "einwand" ? `Einwand: ${String(out.begruendung ?? "")}` : "einverstanden";
    case "entscheidung":
      return out.outcome === "automatisch" ? "automatisch gebucht" : "zur Prüfung";
    case "extraktor":
      return `${String((out.lieferant as { name?: string } | undefined)?.name ?? "")} gelesen`;
    default:
      return "";
  }
}

/** The chain of one or more runs: each step with model, prompt version, confidence and cost. */
export function ProtocolChain({ steps }: { steps: Decision[] }) {
  if (steps.length === 0) return <p className="text-muted-ink">Noch nicht verarbeitet.</p>;
  const runs = [...new Set(steps.map((s) => s.runId))];
  return (
    <div className="space-y-4">
      {runs.map((runId, i) => {
        const run = steps.filter((s) => s.runId === runId);
        const cost = run.reduce((s, r) => s + r.costMicrocents, 0);
        return (
          <ol key={runId} className="ink-card space-y-2" aria-label={`Lauf ${i + 1}`} data-testid="protokoll-lauf">
            <li className="pixel">
              Lauf {i + 1} · {new Date(run[0]?.createdAt ?? 0).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} ·
              Kosten {formatCost(cost)}
            </li>
            {run.map((s) => (
              <li key={s.id} className="grid gap-x-3 text-[14px] sm:grid-cols-[8rem_1fr_auto]">
                <span className="font-semibold">{ROLE_LABEL[s.role] ?? s.role}</span>
                <span className="min-w-0 break-words">{summary(s)}</span>
                <span className="num text-[12px] text-muted-ink sm:text-right">
                  {[
                    s.model,
                    s.promptVersion,
                    s.confidence === null ? null : `Konfidenz ${s.confidence.toFixed(2)}`,
                    s.model ? formatCost(s.costMicrocents) : null,
                    s.durationMs ? `${s.durationMs} ms` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}
