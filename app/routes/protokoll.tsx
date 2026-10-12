import { Link, useLoaderData } from "react-router";
import { StatusChip } from "~/components/ledger";
import { formatCost, ProtocolChain } from "~/components/protocol-chain";
import { currentTenant } from "~/lib/auth.server";
import { getDb } from "~/lib/db/client";
import { protocol } from "~/lib/queries.server";
import type { Route } from "./+types/protokoll";

export const meta: Route.MetaFunction = () => [{ title: "Protokoll · Belegprüfer" }];

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const tenant = await currentTenant(db, request);
  return { runs: await protocol(db, tenant.id) };
}

export default function Protokoll() {
  const { runs } = useLoaderData<typeof loader>();
  const total = runs.reduce((s, r) => s + r.steps.reduce((a, b) => a + b.costMicrocents, 0), 0);
  return (
    <div className="space-y-6">
      <h1>Protokoll</h1>
      <p className="max-w-2xl">
        Jeder Schritt jedes Belegs, wie er entschieden wurde: welches Modell, welche Prompt-Version, wie sicher, was es
        gekostet hat. Das Protokoll wird nur ergänzt, nie geändert.
      </p>
      <p className="pixel">
        Letzte {runs.length} Läufe · zusammen {formatCost(total)}
      </p>
      {runs.length === 0 ? <p className="ink-card text-muted-ink">Noch keine Läufe.</p> : null}
      {runs.map((run) => (
        <section key={run.runId} className="space-y-2">
          <h2 className="flex flex-wrap items-baseline gap-2 text-[20px]">
            <Link to={`/belege/${run.documentId}`}>{run.label}</Link>
            {run.status ? <StatusChip status={run.status} /> : null}
          </h2>
          <ProtocolChain steps={run.steps} />
        </section>
      ))}
    </div>
  );
}
