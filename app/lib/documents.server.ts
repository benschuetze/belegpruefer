import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { documents } from "~/lib/db/schema";

import { MAX_REQUEST_BYTES } from "~/lib/upload-limits";

export const MAX_UPLOAD_BYTES = MAX_REQUEST_BYTES;

export type UploadResult =
  | { status: "neu"; id: string; filename: string }
  | { status: "duplikat"; id: string; filename: string }
  | { status: "abgelehnt"; filename: string; reason: string };

/** XML or PDF by content, not by file name: a renamed file is judged by what it is. */
export function detectKind(bytes: Uint8Array): "xml" | "pdf" | null {
  const head = Buffer.from(bytes.subarray(0, 512)).toString("utf8").replace(/^﻿/, "").trimStart();
  if (head.startsWith("%PDF-")) return "pdf";
  if (head.startsWith("<?xml") || head.startsWith("<")) return "xml";
  return null;
}

/**
 * Stores one uploaded file for a tenant. Every file gets an answer: new, duplicate (same content already there)
 * or rejected with a reason. Nothing disappears silently.
 */
export async function storeUpload(
  db: Db,
  tenantId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<UploadResult> {
  const name = filename.slice(0, 200) || "ohne-namen";
  if (bytes.length === 0) return { status: "abgelehnt", filename: name, reason: "Datei ist leer" };
  if (bytes.length > MAX_UPLOAD_BYTES)
    return { status: "abgelehnt", filename: name, reason: "Datei ist größer als 4 MB" };
  const kind = detectKind(bytes);
  if (!kind) return { status: "abgelehnt", filename: name, reason: "Weder XML noch PDF" };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const [inserted] = await db
    .insert(documents)
    .values({ tenantId, filename: name, kind, sha256, content: Buffer.from(bytes).toString("base64") })
    .onConflictDoNothing({ target: [documents.tenantId, documents.sha256] })
    .returning({ id: documents.id });
  if (inserted) return { status: "neu", id: inserted.id, filename: name };
  const [existing] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.tenantId, tenantId), eq(documents.sha256, sha256)));
  return { status: "duplikat", id: existing?.id ?? "", filename: name };
}
