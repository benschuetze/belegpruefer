import { useLoaderData } from "react-router";
import { LedgerLine } from "~/components/ledger";
import result from "../../evals/ergebnis.json";
import type { Route } from "./+types/eval";

export const meta: Route.MetaFunction = () => [{ title: "Eval · Belegprüfer" }];

type Bucket = { range: string; n: number; accuracy: number | null };
type Variant = {
  id: string;
  label: string;
  accountAccuracy: number;
  taxKeyAccuracy: number;
  automaticShare: number;
  wrongButAutomatic: number;
  wrongButAutomaticCount: number;
  calibration: Bucket[];
  costCentsPerDoc: number;
  secondsPerDoc: number;
};
type Result = {
  measuredAt: string | null;
  note: string;
  cases: number;
  models: Record<string, string>;
  variants: Variant[];
  threshold?: { normal: number; risk: number; reason: string };
};

export function loader() {
  return result as Result;
}

const pct = (v: number | null) =>
  v === null ? "–" : `${(v * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;

export default function Eval() {
  const data = useLoaderData<typeof loader>();
  const full = data.variants.at(-1);
  return (
    <div className="space-y-6">
      <h1>Eval: lohnt sich das Team?</h1>
      <p className="max-w-2xl">
        Vier Aufstellungen auf denselben {data.cases || "erfundenen"} Belegen: Kontierer allein, mit Prüfer, mit
        Recherche, mit Beispielen aus der Historie. Die wichtigste Zahl ist „falsch trotz automatisch“: Buchungen, die
        ohne Mensch durchgegangen wären und falsch sind.
      </p>
      {!data.measuredAt || !full ? (
        <p className="note">{data.note}</p>
      ) : (
        <>
          <section className="space-y-2">
            <p className="pixel">
              Falsch trotz automatisch · {full.label} · gemessen am {data.measuredAt}
            </p>
            <p>
              <span className="summe">{pct(full.wrongButAutomatic)}</span>
            </p>
            <p className="text-[14px] text-muted-ink">
              {full.wrongButAutomaticCount} von {data.cases} Belegen. Modelle:{" "}
              {Object.entries(data.models)
                .map(([r, m]) => `${r} ${m}`)
                .join(", ")}
            </p>
          </section>
          <div className="ink-card overflow-x-auto p-0">
            <table className="w-full text-[14px]">
              <caption className="sr-only">Ablation der vier Aufstellungen</caption>
              <thead>
                <tr className="border-b-2 border-ink text-left">
                  <th className="px-3 py-2">Aufstellung</th>
                  <th className="px-3 py-2 text-right">Konto richtig</th>
                  <th className="px-3 py-2 text-right">BU richtig</th>
                  <th className="px-3 py-2 text-right">automatisch</th>
                  <th className="px-3 py-2 text-right">falsch trotz automatisch</th>
                  <th className="px-3 py-2 text-right">Kosten/Beleg</th>
                  <th className="px-3 py-2 text-right">Zeit/Beleg</th>
                </tr>
              </thead>
              <tbody>
                {data.variants.map((v) => (
                  <tr key={v.id} className="border-b border-grey-5">
                    <th scope="row" className="px-3 py-1 text-left font-semibold">
                      {v.label}
                    </th>
                    <td className="num px-3 py-1 text-right">{pct(v.accountAccuracy)}</td>
                    <td className="num px-3 py-1 text-right">{pct(v.taxKeyAccuracy)}</td>
                    <td className="num px-3 py-1 text-right">{pct(v.automaticShare)}</td>
                    <td className="num px-3 py-1 text-right">{pct(v.wrongButAutomatic)}</td>
                    <td className="num px-3 py-1 text-right">
                      {v.costCentsPerDoc.toLocaleString("de-DE", { maximumFractionDigits: 3 })} ct
                    </td>
                    <td className="num px-3 py-1 text-right">
                      {v.secondsPerDoc.toLocaleString("de-DE", { maximumFractionDigits: 1 })} s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="ink-card max-w-xl space-y-1">
            <h2 className="text-[20px]">Kalibrierung ({full.label})</h2>
            {full.calibration.map((b) => (
              <LedgerLine key={b.range} label={`Konfidenz ${b.range} (${b.n} Belege)`}>
                {pct(b.accuracy)} richtig
              </LedgerLine>
            ))}
          </section>
          {data.threshold ? <p className="note max-w-2xl">{data.threshold.reason}</p> : null}
        </>
      )}
    </div>
  );
}
