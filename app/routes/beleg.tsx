import { data, Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { z } from "zod";
import { Amount, LedgerLine, StatusChip } from "~/components/ledger";
import { ProtocolChain } from "~/components/protocol-chain";
import type { BookingLine, KontiererOutput } from "~/lib/agents/kontierer";
import type { PrueferOutput } from "~/lib/agents/pruefer";
import { currentTenant, isDemo } from "~/lib/auth.server";
import { formatDate, todayInGermany } from "~/lib/dates";
import { getDb } from "~/lib/db/client";
import type { Finding } from "~/lib/db/schema";
import type { Outcome } from "~/lib/decide";
import { confirmDocument, LedgerError, latestProposal, reverseAndRebook } from "~/lib/ledger.server";
import { documentDetail } from "~/lib/queries.server";
import { processMany } from "~/lib/run.server";
import { accountLabel, EXPENSE_ACCOUNTS, TAX_KEYS } from "~/lib/skr03";
import type { Route } from "./+types/beleg";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.detail.doc.extracted?.supplier.name ?? "Beleg"} · Belegprüfer` },
];

const USER_LABEL = "Instanz-Login";

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const tenant = await currentTenant(db, request);
  const detail = await documentDetail(db, tenant.id, params.id);
  // Someone else's document looks exactly like one that does not exist.
  if (!detail) throw new Response("Diesen Beleg gibt es hier nicht.", { status: 404 });
  const output = <T,>(role: string) => detail.latest.find((s) => s.role === role)?.output as T | undefined;
  return {
    detail,
    proposal: await latestProposal(db, tenant.id, params.id),
    pruefer: output<PrueferOutput | { error: string }>("pruefer") ?? null,
    kontiererError: (output<{ error?: string }>("kontierer") as { error?: string } | undefined)?.error ?? null,
    outcome: output<Outcome>("entscheidung") ?? null,
    demo: isDemo(),
  };
}

const intent = z.enum(["passt", "aendern", "storno", "erneut"]);

export async function action({ request, params }: Route.ActionArgs) {
  const db = getDb();
  const tenant = await currentTenant(db, request);
  const form = await request.formData();
  const parsed = intent.safeParse(form.get("intent"));
  if (!parsed.success) return data({ error: "Unbekannte Aktion." }, { status: 400 });
  const detail = await documentDetail(db, tenant.id, params.id);
  if (!detail) throw new Response("Diesen Beleg gibt es hier nicht.", { status: 404 });
  const today = todayInGermany();
  try {
    if (parsed.data === "erneut") {
      await processMany(db, tenant.id, [params.id]);
      return redirect(`/belege/${params.id}`);
    }
    const groups = detail.doc.extracted?.taxGroups ?? [];
    let lines: BookingLine[];
    if (parsed.data === "passt") {
      const proposal = await latestProposal(db, tenant.id, params.id);
      if (!proposal) return data({ error: "Es gibt keinen Vorschlag. Bitte Konto wählen." }, { status: 400 });
      lines = proposal.zeilen;
    } else {
      lines = groups.map((g) => ({
        satz: g.rate,
        konto: String(form.get(`konto_${g.rate}`) ?? ""),
        buSchluessel: String(form.get(`bu_${g.rate}`) ?? ""),
      })) as BookingLine[];
    }
    if (parsed.data === "storno") await reverseAndRebook(db, tenant.id, params.id, lines, USER_LABEL, today);
    else await confirmDocument(db, tenant.id, params.id, lines, USER_LABEL, today);
    return redirect(parsed.data === "storno" ? `/belege/${params.id}` : "/belege?filter=pruefen");
  } catch (error) {
    if (error instanceof LedgerError) return data({ error: error.message }, { status: 400 });
    throw error;
  }
}

export default function Beleg() {
  const { detail, proposal, pruefer, kontiererError, outcome, demo } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const { doc } = detail;
  const beleg = doc.extracted;
  const findings: Finding[] = doc.findings ?? [];
  const canConfirm = doc.status === "pruefen" || doc.status === "automatisch";
  const activeBookings = detail.bookings;

  return (
    <div className="space-y-6">
      <p>
        <Link to="/belege">← Alle Belege</Link>
      </p>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1>{beleg?.supplier.name ?? doc.filename}</h1>
        <StatusChip status={doc.status} />
      </div>
      {actionData?.error ? (
        <p role="alert" className="note-danger">
          {actionData.error}
        </p>
      ) : null}
      {doc.error ? (
        <div className="note-danger space-y-2">
          <p>{doc.error}</p>
          {doc.status === "fehler" && !demo ? (
            <Form method="post">
              <button type="submit" name="intent" value="erneut" className="btn secondary" disabled={busy}>
                Erneut verarbeiten
              </button>
            </Form>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 min-[900px]:grid-cols-2">
        {/* Left: the document as read. */}
        <section aria-labelledby="beleg-titel" className="ink-card space-y-3">
          <h2 id="beleg-titel">Beleg</h2>
          {beleg ? (
            <>
              <div className="space-y-1 text-[14px]">
                <LedgerLine label="Rechnungsnummer" text>
                  {beleg.invoiceNumber ?? "fehlt"}
                </LedgerLine>
                <LedgerLine label="Rechnungsdatum">{formatDate(beleg.issueDate)}</LedgerLine>
                <LedgerLine label="Leistungsdatum">{formatDate(beleg.deliveryDate)}</LedgerLine>
                <LedgerLine label="Lieferant" text>
                  {[
                    beleg.supplier.street,
                    [beleg.supplier.postcode, beleg.supplier.city].filter(Boolean).join(" "),
                    beleg.supplier.country,
                  ]
                    .filter(Boolean)
                    .join(", ") || "ohne Anschrift"}
                </LedgerLine>
                <LedgerLine label="USt-IdNr." text>
                  {beleg.supplier.vatId ?? beleg.supplier.taxNumber ?? "fehlt"}
                </LedgerLine>
                <LedgerLine label="Empfänger" text>
                  {beleg.buyer?.name ?? "–"}
                </LedgerLine>
              </div>
              <h3 className="pixel pt-2">Positionen</h3>
              <ul className="space-y-1">
                {beleg.lines.map((l, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: invoice lines have no id and never reorder
                  <li key={i}>
                    <LedgerLine
                      testId="position"
                      label={`${l.quantity && l.quantity !== 1 ? `${l.quantity} × ` : ""}${l.description} (${l.taxRate} %)`}
                    >
                      <Amount cents={l.netCents} />
                    </LedgerLine>
                  </li>
                ))}
              </ul>
              <div className="space-y-1 border-t-2 border-ink pt-2">
                <LedgerLine label="Netto">
                  <Amount cents={beleg.totals.netCents} />
                </LedgerLine>
                {beleg.taxGroups.map((g) => (
                  <LedgerLine key={g.rate} label={`USt ${g.rate} %${g.category === "AE" ? " (Reverse Charge)" : ""}`}>
                    <Amount cents={g.taxCents} />
                  </LedgerLine>
                ))}
                <LedgerLine label={<strong>Brutto</strong>}>
                  <strong>
                    <Amount cents={beleg.totals.grossCents} />
                  </strong>
                </LedgerLine>
              </div>
              {beleg.notes.length > 0 ? (
                <>
                  <h3 className="pixel pt-2">Hinweise auf dem Beleg</h3>
                  <ul className="list-disc space-y-1 pl-5 text-[14px]">
                    {beleg.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : (
            <p className="text-muted-ink">Nicht ausgelesen.</p>
          )}
          {detail.hasFile ? (
            <p className="text-[14px]">
              <a href={`/belege/${doc.id}/datei`} download={doc.filename} rel="noopener">
                Originaldatei {doc.filename} herunterladen
              </a>
            </p>
          ) : null}
        </section>

        {/* Right: what the team proposes and why. */}
        <section aria-labelledby="vorschlag-titel" className="space-y-4">
          <div className="ink-card space-y-3">
            <h2 id="vorschlag-titel">{activeBookings.length > 0 ? "Gebucht" : "Vorschlag"}</h2>
            {activeBookings.length > 0 ? (
              <div className="space-y-1" data-testid="buchungen">
                {activeBookings.map((b) => (
                  <LedgerLine
                    key={b.id}
                    label={`${b.reversalOf ? "Storno " : ""}${accountLabel(b.account)} an ${b.contraAccount}, BU ${b.taxKey || "–"}${b.lockedAt ? " · fest" : ""}`}
                  >
                    <Amount cents={b.amountCents} />
                  </LedgerLine>
                ))}
              </div>
            ) : proposal ? (
              <ProposalLines proposal={proposal} groups={beleg?.taxGroups ?? []} />
            ) : (
              <p className="text-muted-ink">
                {kontiererError ? `Kein Vorschlag: ${kontiererError}` : "Kein Vorschlag."}
              </p>
            )}
            {proposal ? (
              <div className="space-y-1 text-[14px]">
                <p className="pixel">Kontierer · Konfidenz {proposal.konfidenz.toFixed(2)}</p>
                <p>{proposal.begruendung}</p>
              </div>
            ) : null}
          </div>

          {pruefer ? (
            "urteil" in pruefer ? (
              <div
                className={pruefer.urteil === "einwand" ? "note-danger space-y-1" : "note space-y-1"}
                data-testid="pruefer"
              >
                <p className="pixel" style={{ color: "inherit" }}>
                  Prüfer · {pruefer.urteil === "einwand" ? "Einwand" : "einverstanden"}
                </p>
                <p>{pruefer.begruendung}</p>
                {pruefer.gegenvorschlag?.length ? (
                  <p className="text-[14px]">
                    Gegenvorschlag:{" "}
                    {pruefer.gegenvorschlag
                      .map((z) => `${accountLabel(z.konto)}, BU ${z.buSchluessel || "–"}`)
                      .join("; ")}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="note-danger">Prüfer ohne Antwort: {pruefer.error}</p>
            )
          ) : null}

          {findings.length > 0 ? (
            <div className="ink-card space-y-2" data-testid="befunde">
              <h3 className="pixel">Validator</h3>
              <ul className="space-y-1 text-[14px]">
                {findings.map((f) => (
                  <li key={f.code} className={f.severity === "fehler" ? "text-danger" : "text-muted-ink"}>
                    {f.severity === "fehler" ? "Fehler: " : "Hinweis: "}
                    {f.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {outcome && outcome.reasons.length > 0 && doc.status === "pruefen" ? (
            <div className="ink-card space-y-2">
              <h3 className="pixel">Warum du das prüfen sollst</h3>
              <ul className="list-disc space-y-1 pl-5 text-[14px]">
                {outcome.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!demo && canConfirm && beleg ? (
            <div className="ink-card space-y-3">
              {proposal && activeBookings.length === 0 ? (
                <Form method="post">
                  <button type="submit" name="intent" value="passt" className="btn" disabled={busy}>
                    Passt, buchen
                  </button>
                </Form>
              ) : null}
              {activeBookings.length > 0 && doc.status === "automatisch" ? (
                <Form method="post">
                  <button type="submit" name="intent" value="passt" className="btn" disabled={busy}>
                    Passt, bestätigen
                  </button>
                </Form>
              ) : null}
              <AccountForm
                intentValue="aendern"
                label="Konto ändern"
                submit="Geändert buchen"
                groups={beleg.taxGroups}
                proposal={proposal}
                busy={busy}
              />
            </div>
          ) : null}

          {!demo && doc.status === "festgeschrieben" && beleg ? (
            <div className="ink-card space-y-2">
              <p className="text-[14px]">
                Festgeschrieben. Ändern geht nur über eine Stornobuchung und eine neue Buchung.
              </p>
              <AccountForm
                intentValue="storno"
                label="Korrigieren mit Storno"
                submit="Stornieren und neu buchen"
                groups={beleg.taxGroups}
                proposal={proposal}
                busy={busy}
              />
            </div>
          ) : null}
        </section>
      </div>

      <section aria-labelledby="protokoll-titel" className="space-y-3">
        <h2 id="protokoll-titel">Protokoll</h2>
        <ProtocolChain steps={detail.steps} />
        {detail.reviews.length > 0 ? (
          <ul className="ink-card space-y-1 text-[14px]">
            {detail.reviews.map((r) => (
              <li key={r.id}>
                {new Date(r.createdAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}: {r.userLabel} hat{" "}
                {r.result === "ok" ? "den Vorschlag bestätigt" : "die Kontierung geändert"}.
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function ProposalLines({
  proposal,
  groups,
}: {
  proposal: KontiererOutput;
  groups: { rate: number; netCents: number; taxCents: number }[];
}) {
  return (
    <div className="space-y-1" data-testid="vorschlag">
      {proposal.zeilen.map((z) => {
        const group = groups.find((g) => g.rate === z.satz);
        return (
          <LedgerLine key={z.satz} label={`${accountLabel(z.konto)} an 1600, BU ${z.buSchluessel || "–"}`}>
            {group ? <Amount cents={group.netCents + group.taxCents} /> : "–"}
          </LedgerLine>
        );
      })}
    </div>
  );
}

function AccountForm({
  intentValue,
  label,
  submit,
  groups,
  proposal,
  busy,
}: {
  intentValue: "aendern" | "storno";
  label: string;
  submit: string;
  groups: { rate: number }[];
  proposal: KontiererOutput | null;
  busy: boolean;
}) {
  return (
    <details>
      <summary className="btn secondary inline-block cursor-pointer list-none">{label}</summary>
      <Form method="post" className="mt-3 space-y-3">
        {groups.map((g) => {
          const current = proposal?.zeilen.find((z) => z.satz === g.rate);
          return (
            <fieldset key={g.rate} className="space-y-2">
              <legend className="pixel">Steuersatz {g.rate} %</legend>
              <label className="flex flex-col gap-1 text-[14px]">
                Konto
                <select name={`konto_${g.rate}`} defaultValue={current?.konto ?? "4900"}>
                  {EXPENSE_ACCOUNTS.map((a) => (
                    <option key={a.number} value={a.number}>
                      {a.number} {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[14px]">
                BU-Schlüssel
                <select
                  name={`bu_${g.rate}`}
                  defaultValue={current?.buSchluessel ?? (g.rate === 19 ? "9" : g.rate === 7 ? "8" : "")}
                >
                  {Object.entries(TAX_KEYS).map(([key, v]) => (
                    <option key={key} value={key}>
                      {key || "leer"} · {v.label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          );
        })}
        <button type="submit" name="intent" value={intentValue} className="btn" disabled={busy}>
          {submit}
        </button>
      </Form>
    </details>
  );
}
