import { data, Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { z } from "zod";
import { Amount } from "~/components/ledger";
import { currentTenant, isDemo } from "~/lib/auth.server";
import { formatDate, todayInGermany } from "~/lib/dates";
import { getDb } from "~/lib/db/client";
import { bookingsInPeriod, LedgerError, lockPeriod, openInPeriod } from "~/lib/ledger.server";
import { periodFrom } from "~/lib/period";
import type { Route } from "./+types/export";

export const meta: Route.MetaFunction = () => [{ title: "Export · Belegprüfer" }];

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const tenant = await currentTenant(db, request);
  const { from, to } = periodFrom(new URL(request.url), todayInGermany());
  const [rows, open] = await Promise.all([
    bookingsInPeriod(db, tenant.id, from, to),
    openInPeriod(db, tenant.id, from, to),
  ]);
  return {
    from,
    to,
    open,
    rows,
    allLocked: rows.length > 0 && rows.every((r) => r.lockedAt),
    demo: isDemo(),
  };
}

const form = z.object({ von: z.iso.date(), bis: z.iso.date() });

export async function action({ request }: Route.ActionArgs) {
  const db = getDb();
  const tenant = await currentTenant(db, request);
  const parsed = form.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return data({ error: "Zeitraum ungültig." }, { status: 400 });
  try {
    await lockPeriod(db, tenant.id, parsed.data.von, parsed.data.bis);
  } catch (error) {
    if (error instanceof LedgerError) return data({ error: error.message }, { status: 400 });
    throw error;
  }
  return redirect(`/export?von=${parsed.data.von}&bis=${parsed.data.bis}`);
}

export default function Export() {
  const { from, to, open, rows, allLocked, demo } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const total = rows.reduce((s, r) => s + r.amountCents, 0);
  const query = `von=${from}&bis=${to}`;
  return (
    <div className="space-y-6">
      <h1>Export</h1>
      <Form method="get" className="ink-card flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[14px]">
          Von
          <input type="date" name="von" defaultValue={from} required />
        </label>
        <label className="flex flex-col gap-1 text-[14px]">
          Bis
          <input type="date" name="bis" defaultValue={to} required />
        </label>
        <button type="submit" className="btn secondary">
          Zeitraum anzeigen
        </button>
      </Form>

      <section aria-labelledby="summe-export" className="space-y-2">
        <p className="pixel" id="summe-export">
          {formatDate(from)} bis {formatDate(to)} · {rows.length} Buchungen
        </p>
        <p>
          <span className="summe" data-testid="export-summe">
            <Amount cents={total} />
          </span>
        </p>
      </section>

      {actionData?.error ? (
        <p role="alert" className="note-danger">
          {actionData.error}
        </p>
      ) : null}
      {open > 0 ? (
        <p className="note-danger">
          {open} Beleg(e) aus diesem Zeitraum sind noch offen. <Link to="/belege?filter=pruefen">Erst prüfen</Link>,
          dann festschreiben.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {!demo && !allLocked ? (
          <Form method="post">
            <input type="hidden" name="von" value={from} />
            <input type="hidden" name="bis" value={to} />
            <button type="submit" className="btn" disabled={busy || open > 0 || rows.length === 0}>
              Zeitraum festschreiben
            </button>
          </Form>
        ) : null}
        {allLocked ? (
          <a href={`/export/datei?${query}`} className="btn no-underline" download>
            DATEV-Datei herunterladen
          </a>
        ) : (
          <p className="text-[14px] text-muted-ink">
            Die DATEV-Datei gibt es, sobald alle Buchungen des Zeitraums festgeschrieben sind.
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="ink-card text-muted-ink">Keine Buchungen in diesem Zeitraum.</p>
      ) : (
        <div className="ink-card overflow-x-auto p-0">
          <table className="w-full text-[14px]">
            <caption className="sr-only">Vorschau der Exportzeilen</caption>
            <thead>
              <tr className="border-b-2 border-ink text-left">
                <th className="px-3 py-2 font-semibold">Datum</th>
                <th className="px-3 py-2 font-semibold">Konto</th>
                <th className="px-3 py-2 font-semibold">Gegen</th>
                <th className="px-3 py-2 font-semibold">BU</th>
                <th className="px-3 py-2 font-semibold">Text</th>
                <th className="px-3 py-2 text-right font-semibold">Betrag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-grey-5" data-testid="export-zeile">
                  <td className="num px-3 py-1">{formatDate(r.bookingDate)}</td>
                  <td className="num px-3 py-1">{r.account}</td>
                  <td className="num px-3 py-1">{r.contraAccount}</td>
                  <td className="num px-3 py-1">{r.taxKey || "–"}</td>
                  <td className="px-3 py-1">
                    {r.text}
                    {r.lockedAt ? <span className="pixel ml-2">fest</span> : null}
                  </td>
                  <td className="px-3 py-1 text-right">
                    <Amount cents={r.amountCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
