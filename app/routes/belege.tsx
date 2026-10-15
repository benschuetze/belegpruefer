import { data, Link, useActionData, useLoaderData } from "react-router";
import { Amount, StatusChip } from "~/components/ledger";
import { QueueStatus } from "~/components/queue-status";
import { UploadForm } from "~/components/upload-form";
import { currentTenant, isDemo } from "~/lib/auth.server";
import { formatDate } from "~/lib/dates";
import { getDb } from "~/lib/db/client";
import { storeUpload, type UploadResult } from "~/lib/documents.server";
import { queueLength } from "~/lib/process.server";
import { FILTERS, type Filter, listDocuments } from "~/lib/queries.server";
import { MAX_FILES, MAX_REQUEST_BYTES } from "~/lib/upload-limits";
import type { Route } from "./+types/belege";

export const meta: Route.MetaFunction = () => [{ title: "Belege · Belegprüfer" }];

const FILTER_LABELS: Record<Filter, string> = {
  alle: "Alle",
  pruefen: "Brauchen dich",
  automatisch: "Automatisch",
  bestaetigt: "Bestätigt",
  festgeschrieben: "Festgeschrieben",
};

const TOO_BIG = "Zusammen mehr als 4 MB. Bitte in mehreren Schritten hochladen.";
/** Boundaries and part headers of up to 20 files; the files themselves are checked exactly after parsing. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const tenant = await currentTenant(db, request);
  const raw = new URL(request.url).searchParams.get("filter") ?? "alle";
  const filter: Filter = raw in FILTERS ? (raw as Filter) : "alle";
  const [documents, waiting] = await Promise.all([listDocuments(db, tenant.id, filter), queueLength(db, tenant.id)]);
  return { filter, documents, waiting, demo: isDemo() };
}

/**
 * Store only, answer at once: every file gets an answer (new, duplicate, or rejected with a reason) and new ones
 * wait in the queue. Processing them takes seconds per document; inside this request 20 of them would run into
 * the function timeout. The page works the queue off in short requests to /verarbeiten.
 */
export async function action({ request }: Route.ActionArgs) {
  const db = getDb();
  const tenant = await currentTenant(db, request);
  // Refuse before reading: without a platform in front (self-hosted), formData() would buffer any size.
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_REQUEST_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return data({ results: [], error: TOO_BIG }, { status: 413 });
  }
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.name !== "");
  if (files.length === 0) return data({ results: [], error: "Keine Datei ausgewählt." }, { status: 400 });
  if (files.length > MAX_FILES) {
    return data({ results: [], error: `Höchstens ${MAX_FILES} Dateien auf einmal.` }, { status: 400 });
  }
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_REQUEST_BYTES) {
    return data({ results: [], error: TOO_BIG }, { status: 413 });
  }
  const results: UploadResult[] = [];
  for (const file of files) {
    results.push(await storeUpload(db, tenant.id, file.name, new Uint8Array(await file.arrayBuffer())));
  }
  return { results, error: null };
}

/** What happened to a new file so far; the list refreshes while the queue runs. */
const STATUS_TEXT: Record<string, string> = {
  neu: "wartet auf Prüfung",
  verarbeitung: "wird geprüft …",
  automatisch: "automatisch gebucht",
  pruefen: "braucht dich",
  fehler: "nicht lesbar",
  bestaetigt: "bestätigt",
  festgeschrieben: "festgeschrieben",
};

export default function Belege() {
  const { filter, documents, waiting, demo } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const statusOf = new Map(documents.map((d) => [d.id, d.status]));
  return (
    <div className="space-y-6">
      <h1>Belege</h1>

      {result ? (
        <section role="status" aria-label="Ergebnis des Uploads" className="ink-card space-y-1">
          {result.error ? <p className="text-danger">{result.error}</p> : null}
          {result.results.map((r) => (
            <p key={`${r.filename}-${"id" in r ? r.id : r.status}`} className="text-[14px]">
              <span className="font-semibold">{r.filename}</span>:{" "}
              {r.status === "abgelehnt"
                ? `abgelehnt, ${r.reason}`
                : r.status === "duplikat"
                  ? "schon vorhanden, nicht noch einmal angelegt"
                  : (STATUS_TEXT[statusOf.get(r.id) ?? ""] ?? "angelegt")}
              {"id" in r && r.id ? (
                <>
                  {" "}
                  · <Link to={`/belege/${r.id}`}>ansehen</Link>
                </>
              ) : null}
            </p>
          ))}
        </section>
      ) : null}

      <QueueStatus waiting={waiting} demo={demo} />

      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
          <Link
            key={f}
            to={f === "alle" ? "/belege" : `/belege?filter=${f}`}
            className="chip"
            aria-current={f === filter ? "page" : undefined}
          >
            {FILTER_LABELS[f]}
          </Link>
        ))}
      </nav>

      {documents.length === 0 ? (
        <p className="ink-card text-muted-ink">Hier ist noch nichts. Lade unten Rechnungen hoch.</p>
      ) : (
        <ul className="ink-card divide-y-2 divide-grey-5 p-0">
          {documents.map((d) => (
            <li key={d.id} data-testid="beleg">
              <Link
                to={`/belege/${d.id}`}
                className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-3 py-3 text-ink no-underline hover:bg-muted sm:grid-cols-[8rem_1fr_7rem_8rem]"
              >
                <span>
                  <StatusChip status={d.status} />
                </span>
                <span className="col-span-2 min-w-0 truncate font-semibold sm:col-span-1 sm:order-none">
                  {d.supplier ?? d.filename}
                  <span className="block truncate text-[13px] font-normal text-muted-ink">
                    {formatDate(d.issueDate)} · {d.kind.toUpperCase()}
                    {d.error ? ` · ${d.error}` : ""}
                  </span>
                </span>
                <span className="num text-muted-ink sm:text-right">
                  {d.accounts.length > 0
                    ? d.accounts.join(", ")
                    : d.proposed.length > 0
                      ? `Vorschlag ${d.proposed.join(", ")}`
                      : "–"}
                </span>
                <span className="text-right">{d.grossCents === null ? "–" : <Amount cents={d.grossCents} />}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="max-w-xl">
        <UploadForm disabled={demo} />
      </section>
    </div>
  );
}
