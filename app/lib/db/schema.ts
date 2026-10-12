import { date, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { Beleg } from "~/lib/beleg";

/*
 * Every business table carries tenant_id and every index starts with it: a query that forgets the tenant cannot
 * use an index by accident and stands out in review. Only `meta` and `login_attempts` belong to the instance.
 */

export const documentKind = pgEnum("document_kind", ["xml", "pdf"]);
export const documentStatus = pgEnum("document_status", [
  "neu",
  "verarbeitung",
  "automatisch",
  "pruefen",
  "bestaetigt",
  "festgeschrieben",
  "fehler",
]);
export const bookingSource = pgEnum("booking_source", ["regel", "ki", "manuell"]);
export const decisionRole = pgEnum("decision_role", [
  "parser",
  "extraktor",
  "validator",
  "recherche",
  "kontierer",
  "pruefer",
  "entscheidung",
]);
export const reviewResult = pgEnum("review_result", ["ok", "korrigiert"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kontenrahmen: text("kontenrahmen").notNull().default("SKR03"),
  /** DATEV consultant and client number, needed in the export header. */
  beraterNr: integer("berater_nr").notNull(),
  mandantenNr: integer("mandanten_nr").notNull(),
  /** First month of the fiscal year (1 = calendar year). */
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  createdAt: createdAt(),
});

export type SupplierProfile = {
  sells: string;
  country: string;
  vatIdValid: boolean | null;
  summary: string;
};

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    vatId: text("ust_id"),
    country: text("country"),
    profile: jsonb("profile_jsonb").$type<SupplierProfile>(),
    /** "recherche" (agent), "manuell" or "historie". */
    profileSource: text("profile_source"),
    createdAt: createdAt(),
  },
  (t) => [unique("suppliers_tenant_name").on(t.tenantId, t.name)],
);

export type Finding = {
  code: string;
  severity: "fehler" | "hinweis";
  message: string;
};

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    filename: text("filename").notNull(),
    kind: documentKind("kind").notNull(),
    /** Where the file lives; "db" while it is stored inline below. */
    storageKey: text("storage_key").notNull().default("db"),
    /** Base64 rather than bytea: every driver (neon, node-postgres, PGlite) returns text the same way. */
    content: text("content_base64"),
    sha256: text("sha256").notNull(),
    status: documentStatus("status").notNull().default("neu"),
    extracted: jsonb("extracted_jsonb").$type<Beleg>(),
    findings: jsonb("findings_jsonb").$type<Finding[]>(),
    /** Why processing failed, for status "fehler". Never model output or document text. */
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("documents_tenant_sha256").on(t.tenantId, t.sha256),
    index("documents_tenant_status").on(t.tenantId, t.status),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    bookingDate: date("booking_date").notNull(),
    /** Gross amount of this line in cents; negative only for reversals. */
    amountCents: integer("amount_cents").notNull(),
    account: text("account").notNull(),
    contraAccount: text("contra_account").notNull(),
    taxKey: text("tax_key").notNull(),
    text: text("text").notNull(),
    /** Document number for DATEV "Belegfeld 1". */
    reference: text("reference").notNull(),
    source: bookingSource("source").notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    reversalOf: uuid("reversal_of"),
    createdAt: createdAt(),
  },
  (t) => [
    index("bookings_tenant_document").on(t.tenantId, t.documentId),
    index("bookings_tenant_date").on(t.tenantId, t.bookingDate),
  ],
);

/** Append-only: one row per step and document. A trigger rejects UPDATE and DELETE. */
export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    /** Several runs of the same document (retry after an error, re-run) are told apart by this. */
    runId: uuid("run_id").notNull(),
    role: decisionRole("role").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    input: jsonb("input_jsonb"),
    output: jsonb("output_jsonb"),
    confidence: real("confidence"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    /** Millionths of a cent, so a cheap call is not rounded to zero. */
    costMicrocents: integer("cost_microcents").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("decisions_tenant_document").on(t.tenantId, t.documentId, t.createdAt)],
);

/** Append-only like decisions: what a person confirmed or changed, before and after. */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    userLabel: text("user_label").notNull(),
    result: reviewResult("result").notNull(),
    before: jsonb("before_jsonb"),
    after: jsonb("after_jsonb"),
    createdAt: createdAt(),
  },
  (t) => [index("reviews_tenant_document").on(t.tenantId, t.documentId)],
);

export const exports = pgTable(
  "exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    fileKey: text("file_key").notNull(),
    bookingCount: integer("booking_count").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("exports_tenant_created").on(t.tenantId, t.createdAt)],
);

/** Instance-wide counters (daily LLM budget). */
export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ipHash: text("ip_hash").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_ip_time").on(t.ipHash, t.attemptedAt)],
);

export type Tenant = typeof tenants.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type DocumentStatus = (typeof documentStatus.enumValues)[number];
