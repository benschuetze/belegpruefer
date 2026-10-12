import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { BookingLine, KontiererOutput } from "~/lib/agents/kontierer";
import { bookingLineSchema } from "~/lib/agents/kontierer";
import type { Db } from "~/lib/db/client";
import { bookings, decisions, documents, exports, reviews } from "~/lib/db/schema";
import { bookingsFor, openBookingDate } from "~/lib/process.server";

export class LedgerError extends Error {}

/** The booker's proposal from the latest run, for the review screen and as the default of "Passt, buchen". */
export async function latestProposal(db: Db, tenantId: string, documentId: string): Promise<KontiererOutput | null> {
  const [row] = await db
    .select({ output: decisions.output })
    .from(decisions)
    .where(and(eq(decisions.tenantId, tenantId), eq(decisions.documentId, documentId), eq(decisions.role, "kontierer")))
    .orderBy(desc(decisions.createdAt))
    .limit(1);
  const output = row?.output as Partial<KontiererOutput> | undefined;
  return output?.zeilen ? (output as KontiererOutput) : null;
}

/**
 * A person confirms or changes the booking. Replaces unlocked bookings of the document, records before and after,
 * and marks the document confirmed: all in one transaction.
 */
export async function confirmDocument(
  db: Db,
  tenantId: string,
  documentId: string,
  lines: BookingLine[],
  userLabel: string,
  today: string,
): Promise<void> {
  const parsed = bookingLineSchema.array().min(1).safeParse(lines);
  if (!parsed.success) throw new LedgerError("Ungültige Kontierung.");
  await db.transaction(async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
      .for("update");
    if (!doc?.extracted) throw new LedgerError("Beleg nicht gefunden.");
    if (doc.status !== "pruefen" && doc.status !== "automatisch") {
      throw new LedgerError("Nur offene oder automatisch gebuchte Belege lassen sich bestätigen.");
    }
    const rates = new Set(doc.extracted.taxGroups.map((g) => g.rate));
    if (parsed.data.length !== rates.size || !parsed.data.every((l) => rates.has(l.satz))) {
      throw new LedgerError("Je Steuersatz des Belegs genau eine Zeile.");
    }
    const before = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.documentId, documentId)));
    const proposal = await latestProposal(tx as unknown as Db, tenantId, documentId);
    const proposed: AccountChoice[] =
      before.length > 0
        ? before.map((b) => ({ konto: b.account, buSchluessel: b.taxKey }))
        : (proposal?.zeilen ?? []).map(({ konto, buSchluessel }) => ({ konto, buSchluessel }));
    const changed = !sameChoices(proposed, parsed.data);

    await tx.delete(bookings).where(and(eq(bookings.tenantId, tenantId), eq(bookings.documentId, documentId)));
    await tx
      .insert(bookings)
      .values(
        bookingsFor(
          tenantId,
          documentId,
          doc.extracted,
          parsed.data,
          changed ? "manuell" : "ki",
          await openBookingDate(tx, tenantId, doc.extracted.issueDate, today),
        ),
      );
    await tx.insert(reviews).values({
      tenantId,
      documentId,
      userLabel,
      result: changed ? "korrigiert" : "ok",
      before: proposed,
      after: parsed.data,
    });
    await tx
      .update(documents)
      .set({ status: "bestaetigt" })
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)));
  });
}

type AccountChoice = { konto: string; buSchluessel: string };

/** "Changed" means a different account or tax key; amounts always come from the document. */
function sameChoices(a: AccountChoice[], b: AccountChoice[]): boolean {
  const key = (l: AccountChoice) => `${l.konto}/${l.buSchluessel}`;
  return a.map(key).sort().join() === b.map(key).sort().join();
}

/** Open documents in a period: invoices dated in it that nobody has decided yet. */
export async function openInPeriod(db: Db, tenantId: string, from: string, to: string): Promise<number> {
  const issue = sql<string>`${documents.extracted}->>'issueDate'`;
  return db.$count(
    documents,
    and(
      eq(documents.tenantId, tenantId),
      inArray(documents.status, ["neu", "verarbeitung", "pruefen", "fehler"]),
      sql`${issue} between ${from} and ${to}`,
    ),
  );
}

export async function bookingsInPeriod(db: Db, tenantId: string, from: string, to: string) {
  return db
    .select()
    .from(bookings)
    .where(and(eq(bookings.tenantId, tenantId), gte(bookings.bookingDate, from), lte(bookings.bookingDate, to)))
    .orderBy(asc(bookings.bookingDate), asc(bookings.createdAt));
}

/**
 * Festschreiben: every booking in the period becomes final. Refused while documents of the period are still open,
 * so an export never silently leaves something out.
 */
export async function lockPeriod(db: Db, tenantId: string, from: string, to: string, now = new Date()) {
  if (from > to) throw new LedgerError("Der Zeitraum ist leer.");
  const open = await openInPeriod(db, tenantId, from, to);
  if (open > 0) throw new LedgerError(`${open} Beleg(e) im Zeitraum sind noch offen. Erst prüfen, dann festschreiben.`);
  return db.transaction(async (tx) => {
    const locked = await tx
      .update(bookings)
      .set({ lockedAt: now })
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          isNull(bookings.lockedAt),
          gte(bookings.bookingDate, from),
          lte(bookings.bookingDate, to),
        ),
      )
      .returning({ documentId: bookings.documentId });
    const ids = [...new Set(locked.map((b) => b.documentId))];
    if (ids.length > 0) {
      await tx
        .update(documents)
        .set({ status: "festgeschrieben" })
        .where(and(eq(documents.tenantId, tenantId), inArray(documents.id, ids)));
    }
    const count = await tx.$count(
      bookings,
      and(
        eq(bookings.tenantId, tenantId),
        isNotNull(bookings.lockedAt),
        gte(bookings.bookingDate, from),
        lte(bookings.bookingDate, to),
      ),
    );
    await tx
      .insert(exports)
      .values({ tenantId, periodFrom: from, periodTo: to, fileKey: "download", bookingCount: count });
    return { newlyLocked: locked.length, total: count };
  });
}

/**
 * Correction after Festschreiben: the locked bookings stay untouched, a reversal with the opposite amount cancels
 * them, and the corrected booking is added. The database trigger would refuse any other way.
 */
export async function reverseAndRebook(
  db: Db,
  tenantId: string,
  documentId: string,
  lines: BookingLine[],
  userLabel: string,
  today: string,
): Promise<void> {
  const parsed = bookingLineSchema.array().min(1).safeParse(lines);
  if (!parsed.success) throw new LedgerError("Ungültige Kontierung.");
  await db.transaction(async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
      .for("update");
    if (!doc?.extracted || doc.status !== "festgeschrieben") {
      throw new LedgerError("Storno gibt es nur für festgeschriebene Belege.");
    }
    const all = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.documentId, documentId)));
    const reversed = new Set(all.map((b) => b.reversalOf).filter(Boolean));
    const active = all.filter((b) => b.lockedAt && !b.reversalOf && !reversed.has(b.id));
    if (active.length === 0) throw new LedgerError("Keine festgeschriebene Buchung zum Stornieren.");
    await tx.insert(bookings).values(
      active.map((b) => ({
        tenantId,
        documentId,
        bookingDate: today,
        amountCents: -b.amountCents,
        account: b.account,
        contraAccount: b.contraAccount,
        taxKey: b.taxKey,
        text: `Storno ${b.text}`.slice(0, 60),
        reference: b.reference,
        source: "manuell" as const,
        reversalOf: b.id,
      })),
    );
    // The correction belongs to the period it is made in, like the reversal; the closed period stays as exported.
    await tx.insert(bookings).values(bookingsFor(tenantId, documentId, doc.extracted, parsed.data, "manuell", today));
    await tx.insert(reviews).values({
      tenantId,
      documentId,
      userLabel,
      result: "korrigiert",
      before: active.map((b) => ({ konto: b.account, buSchluessel: b.taxKey })),
      after: parsed.data,
    });
    await tx
      .update(documents)
      .set({ status: "bestaetigt" })
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)));
  });
}
