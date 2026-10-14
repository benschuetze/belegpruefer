import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { extractPdf } from "~/lib/agents/extraktor";
import type { BookingLine, Example, KontiererOutput } from "~/lib/agents/kontierer";
import type { AgentModels } from "~/lib/agents/models";
import { PROMPT_VERSIONS } from "~/lib/agents/prompts";
import type { PrueferOutput } from "~/lib/agents/pruefer";
import type { ResearchTools } from "~/lib/agents/recherche";
import type { Beleg } from "~/lib/beleg";
import { takeFromDailyBudget } from "~/lib/daily-budget.server";
import type { Db, Tx } from "~/lib/db/client";
import {
  bookings,
  decisions,
  documents,
  exports,
  type Finding,
  type NewBooking,
  type SupplierProfile,
  suppliers,
  tenants,
} from "~/lib/db/schema";
import { DEFAULT_THRESHOLDS, decide, type Outcome, type Thresholds } from "~/lib/decide";
import { parseInvoiceXml } from "~/lib/parser/cii";
import { safeError } from "~/lib/security.server";
import { CONTRA_ACCOUNT } from "~/lib/skr03";
import { FULL_TEAM, plannedCalls, runTeam, type Step, type Team, unknownSupplier } from "~/lib/team";
import { validateBeleg } from "~/lib/validator";

export const DAILY_LLM_CALLS = Number(process.env.LLM_DAILY_LIMIT ?? 600);
export const PARALLEL_DOCUMENTS = 3;
/**
 * A run that has not finished after this long is considered dead (function timeout, crash, deploy). Far above
 * what one request of processQueue takes, so a live run is never overtaken. Must stay above the function timeout
 * (Vercel default 300 s, no maxDuration set): a run still alive past it would be overtaken and its model calls
 * paid twice, though never booked twice.
 */
export const STALE_AFTER_MS = 5 * 60 * 1000;

export type ProcessDeps = {
  models: AgentModels | null;
  research: ResearchTools;
  today: string;
  team?: Team;
  thresholds?: Thresholds;
  /** Clock for the claim; tests move it to simulate a run that died. */
  now?: () => Date;
};

/** Another run took the document over while this one was still busy; this run must not write anything. */
class ClaimLost extends Error {}

/** New, failed on request, or left behind by a run that died. */
function claimable(tenantId: string, now: Date) {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
  return and(
    eq(documents.tenantId, tenantId),
    or(
      eq(documents.status, "neu"),
      and(
        eq(documents.status, "verarbeitung"),
        or(isNull(documents.processingStartedAt), lt(documents.processingStartedAt, staleBefore)),
      ),
    ),
  );
}

export type ProcessResult =
  | { status: "automatisch" | "pruefen"; outcome: Outcome }
  | { status: "fehler"; error: string }
  | { status: "uebersprungen" };

/** Document states a human has signed off. Only these count as history and as examples. */
export const CONFIRMED_STATUSES = ["bestaetigt", "festgeschrieben"] as const;

export function bookingText(beleg: Beleg): string {
  return `${beleg.supplier.name} ${beleg.invoiceNumber ?? ""}`.trim().slice(0, 60);
}

/**
 * The date a new booking goes under: the invoice date, unless that period is already festgeschrieben. A closed
 * period never gets anything added afterwards, so the export of that period stays exactly as it was.
 */
export async function openBookingDate(tx: Tx, tenantId: string, issueDate: string | undefined, today: string) {
  if (!issueDate) return today;
  const [row] = await tx
    .select({ n: count() })
    .from(exports)
    .where(and(eq(exports.tenantId, tenantId), lte(exports.periodFrom, issueDate), gte(exports.periodTo, issueDate)));
  return (row?.n ?? 0) > 0 ? today : issueDate;
}

/**
 * Serialises everything that writes bookings for one tenant (processing, confirming, reversing, locking a period)
 * until the transaction ends. Without it, a document could check "period still open" while a parallel
 * Festschreiben closes it, and land unlocked in a period that was already exported.
 */
export async function lockLedger(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`);
}

export function bookingsFor(
  tenantId: string,
  documentId: string,
  beleg: Beleg,
  lines: BookingLine[],
  source: NewBooking["source"],
  bookingDate: string,
): NewBooking[] {
  return lines.map((line) => {
    const group = beleg.taxGroups.find((g) => g.rate === line.satz);
    if (!group) throw new Error(`Keine Steuergruppe für ${line.satz} %`);
    return {
      tenantId,
      documentId,
      bookingDate,
      amountCents: group.netCents + group.taxCents,
      account: line.konto,
      contraAccount: CONTRA_ACCOUNT,
      taxKey: line.buSchluessel,
      text: bookingText(beleg),
      reference: beleg.invoiceNumber ?? documentId.slice(0, 8),
      source,
    };
  });
}

/**
 * Earlier bookings of this tenant at the same supplier (name as on the invoice, case-insensitive) that a person
 * has confirmed. Same supplier only: "Hotel …" must not pull in every hotel the tenant ever stayed at.
 */
export async function supplierHistory(db: Db, tenantId: string, name: string, limit = 5) {
  const rows = await db
    .select({ extracted: documents.extracted, account: bookings.account, taxKey: bookings.taxKey, text: bookings.text })
    .from(bookings)
    .innerJoin(documents, and(eq(documents.id, bookings.documentId), eq(documents.tenantId, bookings.tenantId)))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        inArray(documents.status, [...CONFIRMED_STATUSES]),
        sql`lower(${documents.extracted}->'supplier'->>'name') = lower(${name})`,
      ),
    )
    .orderBy(desc(bookings.createdAt))
    .limit(limit);
  return rows;
}

function examplesFrom(rows: Awaited<ReturnType<typeof supplierHistory>>): Example[] {
  return rows.map((r) => ({
    lieferant: r.extracted?.supplier.name ?? r.text,
    positionen: (r.extracted?.lines ?? []).map((l) => l.description).slice(0, 5),
    konto: r.account,
    buSchluessel: r.taxKey,
  }));
}

/**
 * The whole chain for one document: read, validate, research if the supplier is new, book, review, decide.
 * Models only read and propose; everything is written by this function in one transaction at the end, so a crash
 * halfway leaves the document as it was plus status "fehler", never with half a protocol or half a booking.
 */
export async function processDocument(
  db: Db,
  tenantId: string,
  documentId: string,
  deps: ProcessDeps,
): Promise<ProcessResult> {
  const team = deps.team ?? FULL_TEAM;
  // Claim the document: a second click or a parallel run finds nothing to claim and stops. Milliseconds only, so
  // the value read back compares equal to the one written.
  const claimedAt = new Date((deps.now ?? (() => new Date()))().getTime());
  const [doc] = await db
    .update(documents)
    .set({ status: "verarbeitung", error: null, processingStartedAt: claimedAt })
    .where(
      and(
        eq(documents.id, documentId),
        or(claimable(tenantId, claimedAt), and(eq(documents.tenantId, tenantId), eq(documents.status, "fehler"))),
      ),
    )
    .returning();
  if (!doc) return { status: "uebersprungen" };
  // Every write of this run goes through here: it only lands while the claim is still this run's.
  const stillMine = and(
    eq(documents.tenantId, tenantId),
    eq(documents.id, documentId),
    eq(documents.status, "verarbeitung"),
    eq(documents.processingStartedAt, claimedAt),
  );

  try {
    const steps: Step[] = [];
    // Always `return await fail(...)`: without the await, a rejection (ClaimLost, database error) would skip the
    // catch below and leave the document hanging in "verarbeitung".
    const fail = async (error: string, extra: Step[] = []) => {
      await db.transaction(async (tx) => {
        const runId = randomUUID();
        const rows = [...steps, ...extra].map((s) => ({ ...s, tenantId, documentId, runId }));
        const updated = await tx
          .update(documents)
          .set({ status: "fehler", error, processingStartedAt: null })
          .where(stillMine)
          .returning({ id: documents.id });
        if (updated.length === 0) throw new ClaimLost();
        if (rows.length > 0) await tx.insert(decisions).values(rows);
      });
      return { status: "fehler" as const, error };
    };

    // 1. Read: deterministic for XML, vision model for PDF.
    let beleg: Beleg;
    const bytes = Buffer.from(doc.content ?? "", "base64");
    if (doc.kind === "xml") {
      const parsed = parseInvoiceXml(bytes.toString("utf8"));
      steps.push({
        role: "parser",
        model: null,
        promptVersion: null,
        input: { filename: doc.filename, bytes: bytes.length },
        output: parsed.ok ? { profile: parsed.profile } : { reason: parsed.reason },
      });
      if (!parsed.ok) return await fail(`Nicht lesbar: ${parsed.reason}`);
      beleg = parsed.beleg;
    } else {
      if (!deps.models) return await fail("PDF braucht das KI-Modell, das auf dieser Instanz nicht eingerichtet ist.");
      if ((await takeFromDailyBudget(db, "llm_calls", 1, DAILY_LLM_CALLS)) < 1) {
        return await fail("Tageslimit für KI-Aufrufe erreicht. Morgen erneut versuchen.");
      }
      const extracted = await extractPdf(deps.models.extraktor, bytes);
      steps.push({
        role: "extraktor",
        model: extracted.model,
        promptVersion: PROMPT_VERSIONS.extraktor,
        input: { filename: doc.filename, bytes: bytes.length },
        output: extracted.output ?? { error: extracted.error },
        confidence: extracted.beleg ? extracted.minConfidence : null,
        tokensIn: extracted.usage.inputTokens,
        tokensOut: extracted.usage.outputTokens,
        costMicrocents: extracted.costMicrocents,
        durationMs: extracted.durationMs,
      });
      if (!extracted.beleg) return await fail(`PDF nicht lesbar: ${extracted.error ?? "keine verwertbare Antwort"}`);
      beleg = extracted.beleg;
    }

    // 2. Validate in code.
    const findings: Finding[] = validateBeleg(beleg, deps.today);
    if (doc.kind === "pdf" && steps[0]?.confidence !== null && (steps[0]?.confidence ?? 1) < 0.8) {
      findings.push({ code: "extraktion_unsicher", severity: "fehler", message: "Felder der PDF unsicher gelesen." });
    }
    steps.push({ role: "validator", model: null, promptVersion: null, input: null, output: findings });

    // 3. Agents, if a model is configured and today's budget allows the calls.
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    const [known] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.name, beleg.supplier.name)));
    const history = examplesFrom(await supplierHistory(db, tenantId, beleg.supplier.name));
    const knownProfile = (known?.profile as SupplierProfile | null) ?? null;
    const calls = plannedCalls(team, unknownSupplier(knownProfile, history));
    const budgetOk =
      deps.models !== null && (await takeFromDailyBudget(db, "llm_calls", calls, DAILY_LLM_CALLS)) === calls;

    let kontierer: KontiererOutput | null = null;
    let pruefer: PrueferOutput | null | undefined;
    let profile = knownProfile;
    let researched = false;
    if (deps.models && budgetOk) {
      const result = await runTeam({
        models: deps.models,
        beleg,
        tenantName: tenant?.name ?? "",
        history,
        knownProfile,
        team,
        research: deps.research,
      });
      steps.push(...result.steps);
      ({ kontierer, pruefer, profile, researched } = result);
    }

    // 4. Decide in code.
    const outcome = decide({
      beleg,
      findings,
      kontierer,
      pruefer,
      thresholds: deps.thresholds ?? DEFAULT_THRESHOLDS,
    });
    if (!deps.models) outcome.reasons.unshift("Kein KI-Modell eingerichtet.");
    else if (!budgetOk) outcome.reasons.unshift("Tageslimit für KI-Aufrufe erreicht.");
    steps.push({
      role: "entscheidung",
      model: null,
      promptVersion: null,
      input: { thresholds: deps.thresholds ?? DEFAULT_THRESHOLDS, team },
      output: outcome,
      confidence: kontierer?.konfidenz ?? null,
    });

    // 5. Write everything at once.
    const runId = randomUUID();
    await db.transaction(async (tx) => {
      await lockLedger(tx, tenantId);
      // First, so a run that was taken over writes nothing at all: no second protocol, no second booking.
      const updated = await tx
        .update(documents)
        .set({
          status: outcome.outcome,
          extracted: beleg,
          findings: [...findings, ...outcome.bookingFindings],
          error: null,
          processingStartedAt: null,
        })
        .where(stillMine)
        .returning({ id: documents.id });
      if (updated.length === 0) throw new ClaimLost();
      await tx.insert(decisions).values(steps.map((s) => ({ ...s, tenantId, documentId, runId })));
      await tx
        .insert(suppliers)
        .values({
          tenantId,
          name: beleg.supplier.name,
          vatId: beleg.supplier.vatId,
          country: beleg.supplier.country,
          profile,
          profileSource: researched ? "recherche" : null,
        })
        .onConflictDoUpdate({
          target: [suppliers.tenantId, suppliers.name],
          set: researched ? { profile, profileSource: "recherche" } : { vatId: beleg.supplier.vatId },
        });
      if (outcome.outcome === "automatisch" && kontierer) {
        const date = await openBookingDate(tx, tenantId, beleg.issueDate, deps.today);
        await tx.insert(bookings).values(bookingsFor(tenantId, documentId, beleg, kontierer.zeilen, "ki", date));
      }
    });
    return { status: outcome.outcome, outcome };
  } catch (error) {
    if (error instanceof ClaimLost) return { status: "uebersprungen" };
    // Drizzle wraps database errors as "Failed query: <sql> params: <values>"; the values are invoice data and
    // must not end up in a log or on screen. The cause carries the database's own message.
    const cause = error instanceof Error && error.cause ? error.cause : error;
    const message = `Verarbeitung abgebrochen: ${safeError(cause)}`;
    console.error(message);
    const updated = await db
      .update(documents)
      .set({ status: "fehler", error: message.slice(0, 500), processingStartedAt: null })
      .where(stillMine)
      .returning({ id: documents.id });
    if (updated.length === 0) return { status: "uebersprungen" };
    return { status: "fehler", error: message };
  }
}

/** Runs documents with at most `limit` at a time: fast enough, and gentle on rate limits and the database. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * The documents table is the queue: status "neu" means waiting. One call takes at most `max` of the oldest
 * waiting documents of this tenant (plus any a dead run left behind) and processes them. Short on purpose: a
 * request never comes near the function timeout, and whatever is left waits for the next call.
 */
export async function nextInQueue(db: Db, tenantId: string, max: number, now = new Date()): Promise<string[]> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(claimable(tenantId, now))
    .orderBy(asc(documents.createdAt))
    .limit(max);
  return rows.map((r) => r.id);
}

/** Waiting or in progress: what the page shows as "wird geprüft" and why it keeps asking. */
export async function queueLength(db: Db, tenantId: string): Promise<number> {
  return db.$count(
    documents,
    and(eq(documents.tenantId, tenantId), inArray(documents.status, ["neu", "verarbeitung"])),
  );
}
