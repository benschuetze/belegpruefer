import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "~/lib/db/client";
import { bookings, type DocumentStatus, decisions, documents, reviews } from "~/lib/db/schema";

export type Overview = {
  needYou: number;
  received: number;
  automatic: number;
  review: number;
  failed: number;
  confirmed: number;
  locked: number;
  /** Uploaded, not yet through the chain. */
  waiting: number;
};

export async function overview(db: Db, tenantId: string): Promise<Overview> {
  const rows = await db
    .select({ status: documents.status, n: count() })
    .from(documents)
    .where(eq(documents.tenantId, tenantId))
    .groupBy(documents.status);
  const by = (s: DocumentStatus) => rows.find((r) => r.status === s)?.n ?? 0;
  return {
    needYou: by("pruefen") + by("fehler"),
    received: rows.reduce((s, r) => s + r.n, 0),
    automatic: by("automatisch"),
    review: by("pruefen"),
    failed: by("fehler"),
    confirmed: by("bestaetigt"),
    locked: by("festgeschrieben"),
    waiting: by("neu") + by("verarbeitung"),
  };
}

export const FILTERS = {
  alle: null,
  pruefen: ["pruefen", "fehler"],
  automatisch: ["automatisch"],
  bestaetigt: ["bestaetigt"],
  festgeschrieben: ["festgeschrieben"],
} as const satisfies Record<string, readonly DocumentStatus[] | null>;
export type Filter = keyof typeof FILTERS;

export async function listDocuments(db: Db, tenantId: string, filter: Filter) {
  const statuses = FILTERS[filter];
  const docs = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      kind: documents.kind,
      status: documents.status,
      extracted: documents.extracted,
      error: documents.error,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.tenantId, tenantId), statuses ? inArray(documents.status, [...statuses]) : undefined))
    // Newest invoice first by the date printed on it; upload time only breaks ties and orders unreadable files.
    .orderBy(sql`${documents.extracted}->>'issueDate' desc nulls last`, desc(documents.createdAt))
    .limit(200);
  const ids = docs.map((d) => d.id);
  const accounts =
    ids.length === 0
      ? []
      : await db
          .select({ documentId: bookings.documentId, account: bookings.account })
          .from(bookings)
          .where(
            and(
              eq(bookings.tenantId, tenantId),
              inArray(bookings.documentId, ids),
              sql`${bookings.reversalOf} is null`,
            ),
          );
  // Documents without a booking show what the booker proposed, marked as a proposal.
  const proposals =
    ids.length === 0
      ? []
      : await db
          .select({ documentId: decisions.documentId, output: decisions.output })
          .from(decisions)
          .where(
            and(eq(decisions.tenantId, tenantId), inArray(decisions.documentId, ids), eq(decisions.role, "kontierer")),
          )
          .orderBy(asc(decisions.createdAt));
  return docs.map((d) => {
    const booked = [...new Set(accounts.filter((a) => a.documentId === d.id).map((a) => a.account))];
    const proposal = proposals.filter((p) => p.documentId === d.id).at(-1)?.output as
      | { zeilen?: { konto: string }[] }
      | undefined;
    return {
      ...d,
      supplier: d.extracted?.supplier.name ?? null,
      grossCents: d.extracted?.totals.grossCents ?? null,
      issueDate: d.extracted?.issueDate ?? null,
      accounts: booked,
      proposed: booked.length > 0 ? [] : [...new Set((proposal?.zeilen ?? []).map((z) => z.konto))],
    };
  });
}

const documentId = z.uuid();

/** An id that is not even a UUID cannot exist; answering that before the query keeps it a 404, not a 500. */
export function isDocumentId(id: string): boolean {
  return documentId.safeParse(id).success;
}

export async function documentDetail(db: Db, tenantId: string, id: string) {
  if (!isDocumentId(id)) return null;
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.tenantId, tenantId), eq(documents.id, id)));
  if (!doc) return null;
  const [steps, booked, reviewed] = await Promise.all([
    db
      .select()
      .from(decisions)
      .where(and(eq(decisions.tenantId, tenantId), eq(decisions.documentId, id)))
      .orderBy(asc(decisions.createdAt)),
    db
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), eq(bookings.documentId, id)))
      .orderBy(asc(bookings.createdAt)),
    db
      .select()
      .from(reviews)
      .where(and(eq(reviews.tenantId, tenantId), eq(reviews.documentId, id)))
      .orderBy(asc(reviews.createdAt)),
  ]);
  // The latest run decides what the review screen shows; earlier runs stay in the protocol.
  const lastRun = steps.at(-1)?.runId;
  return {
    doc: { ...doc, content: undefined },
    hasFile: Boolean(doc.content),
    steps,
    latest: steps.filter((s) => s.runId === lastRun),
    bookings: booked,
    reviews: reviewed,
  };
}

export async function documentFile(db: Db, tenantId: string, id: string) {
  if (!isDocumentId(id)) return null;
  const [doc] = await db
    .select({ content: documents.content, kind: documents.kind, filename: documents.filename })
    .from(documents)
    .where(and(eq(documents.tenantId, tenantId), eq(documents.id, id)));
  return doc ?? null;
}

/** The protocol across documents: newest runs first, each with its chain of steps. */
export async function protocol(db: Db, tenantId: string, limit = 30) {
  const recent = await db
    .select({ runId: decisions.runId, documentId: decisions.documentId, at: sql<Date>`max(${decisions.createdAt})` })
    .from(decisions)
    .where(eq(decisions.tenantId, tenantId))
    .groupBy(decisions.runId, decisions.documentId)
    .orderBy(desc(sql`max(${decisions.createdAt})`))
    .limit(limit);
  const runIds = recent.map((r) => r.runId);
  if (runIds.length === 0) return [];
  const [steps, docs] = await Promise.all([
    db
      .select()
      .from(decisions)
      .where(and(eq(decisions.tenantId, tenantId), inArray(decisions.runId, runIds)))
      .orderBy(asc(decisions.createdAt)),
    db
      .select({
        id: documents.id,
        filename: documents.filename,
        extracted: documents.extracted,
        status: documents.status,
      })
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, tenantId),
          inArray(
            documents.id,
            recent.map((r) => r.documentId),
          ),
        ),
      ),
  ]);
  return recent.map((r) => {
    const doc = docs.find((d) => d.id === r.documentId);
    return {
      runId: r.runId,
      documentId: r.documentId,
      label: doc?.extracted?.supplier.name ?? doc?.filename ?? "?",
      status: doc?.status ?? null,
      steps: steps.filter((s) => s.runId === r.runId),
    };
  });
}
