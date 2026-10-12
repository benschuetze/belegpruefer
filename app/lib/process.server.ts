import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { extractPdf } from "~/lib/agents/extraktor";
import type { BookingLine, Example, KontiererOutput } from "~/lib/agents/kontierer";
import type { AgentModels } from "~/lib/agents/models";
import { PROMPT_VERSIONS } from "~/lib/agents/prompts";
import type { PrueferOutput } from "~/lib/agents/pruefer";
import type { ResearchTools } from "~/lib/agents/recherche";
import type { Beleg } from "~/lib/beleg";
import { takeFromDailyBudget } from "~/lib/daily-budget.server";
import type { Db } from "~/lib/db/client";
import {
  bookings,
  decisions,
  documents,
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

export type ProcessDeps = {
  models: AgentModels | null;
  research: ResearchTools;
  today: string;
  team?: Team;
  thresholds?: Thresholds;
};

export type ProcessResult =
  | { status: "automatisch" | "pruefen"; outcome: Outcome }
  | { status: "fehler"; error: string }
  | { status: "uebersprungen" };

/** Document states a human has signed off. Only these count as history and as examples. */
export const CONFIRMED_STATUSES = ["bestaetigt", "festgeschrieben"] as const;

export function bookingText(beleg: Beleg): string {
  return `${beleg.supplier.name} ${beleg.invoiceNumber ?? ""}`.trim().slice(0, 60);
}

export function bookingsFor(
  tenantId: string,
  documentId: string,
  beleg: Beleg,
  lines: BookingLine[],
  source: NewBooking["source"],
  today: string,
): NewBooking[] {
  return lines.map((line) => {
    const group = beleg.taxGroups.find((g) => g.rate === line.satz);
    if (!group) throw new Error(`Keine Steuergruppe für ${line.satz} %`);
    return {
      tenantId,
      documentId,
      bookingDate: beleg.issueDate ?? today,
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

/** Earlier bookings of this tenant at a supplier with a similar name that a person has confirmed. */
export async function supplierHistory(db: Db, tenantId: string, name: string, limit = 5) {
  const pattern = `%${name.replace(/[%_\\]/g, "").split(/\s+/)[0] ?? ""}%`;
  const rows = await db
    .select({ extracted: documents.extracted, account: bookings.account, taxKey: bookings.taxKey, text: bookings.text })
    .from(bookings)
    .innerJoin(documents, and(eq(documents.id, bookings.documentId), eq(documents.tenantId, bookings.tenantId)))
    .where(
      and(
        eq(bookings.tenantId, tenantId),
        inArray(documents.status, [...CONFIRMED_STATUSES]),
        ilike(bookings.text, pattern),
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
  // Claim the document: a second click or a parallel run finds nothing to claim and stops.
  const [doc] = await db
    .update(documents)
    .set({ status: "verarbeitung", error: null })
    .where(
      and(eq(documents.tenantId, tenantId), eq(documents.id, documentId), inArray(documents.status, ["neu", "fehler"])),
    )
    .returning();
  if (!doc) return { status: "uebersprungen" };

  try {
    const steps: Step[] = [];
    const fail = async (error: string, extra: Step[] = []) => {
      await db.transaction(async (tx) => {
        const runId = randomUUID();
        const rows = [...steps, ...extra].map((s) => ({ ...s, tenantId, documentId, runId }));
        if (rows.length > 0) await tx.insert(decisions).values(rows);
        await tx
          .update(documents)
          .set({ status: "fehler", error })
          .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)));
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
      if (!parsed.ok) return fail(`Nicht lesbar: ${parsed.reason}`);
      beleg = parsed.beleg;
    } else {
      if (!deps.models) return fail("PDF braucht das KI-Modell, das auf dieser Instanz nicht eingerichtet ist.");
      if ((await takeFromDailyBudget(db, "llm_calls", 1, DAILY_LLM_CALLS)) < 1) {
        return fail("Tageslimit für KI-Aufrufe erreicht. Morgen erneut versuchen.");
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
      if (!extracted.beleg) return fail(`PDF nicht lesbar: ${extracted.error ?? "keine verwertbare Antwort"}`);
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
        await tx.insert(bookings).values(bookingsFor(tenantId, documentId, beleg, kontierer.zeilen, "ki", deps.today));
      }
      await tx
        .update(documents)
        .set({
          status: outcome.outcome,
          extracted: beleg,
          findings: [...findings, ...outcome.bookingFindings],
          error: null,
        })
        .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)));
    });
    return { status: outcome.outcome, outcome };
  } catch (error) {
    // Drizzle wraps database errors as "Failed query: <sql> params: <values>"; the values are invoice data and
    // must not end up in a log or on screen. The cause carries the database's own message.
    const cause = error instanceof Error && error.cause ? error.cause : error;
    const message = `Verarbeitung abgebrochen: ${safeError(cause)}`;
    console.error(message);
    await db
      .update(documents)
      .set({ status: "fehler", error: message.slice(0, 500) })
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)));
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
