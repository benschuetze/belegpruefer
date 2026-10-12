import { createHash, randomBytes } from "node:crypto";

export function createNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * Strict CSP from the OWASP cheat sheet: only scripts carrying this response's nonce run, plus what they load.
 * Development keeps Vite's injected scripts working, so the policy applies to production builds only.
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // Everything the app loads comes from itself. Locking each kind down means injected markup cannot send
    // data to another host. No default-src: it would also block React's inline style attributes.
    "connect-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
  ].join("; ");
}

/** Headers that belong on every response, documents and data requests alike. */
export function applySecurityHeaders(headers: Headers): void {
  headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  // Clients' invoices have no business in a search index; the demo is linked directly, not found via search.
  headers.set("X-Robots-Tag", "noindex, nofollow");
}

/**
 * CSRF check for state-changing requests, in the order the OWASP cheat sheet recommends:
 * Fetch Metadata first, then Origin, then Referer. No usable signal means reject, not allow.
 */
export function isCrossSiteWrite(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return false;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site) return site !== "same-origin" && site !== "none";
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin && origin !== "null") return origin !== expected;
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin !== expected;
    } catch {
      return true;
    }
  }
  return true;
}

/** Stored instead of the raw IP: enough to count attempts, useless to anyone reading the table. */
export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(`${process.env.SESSION_SECRET ?? ""}:${ip}`)
    .digest("hex")
    .slice(0, 32);
}

export function clientIp(request: Request): string {
  // On Vercel the platform sets x-forwarded-for; the first entry is the client.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/**
 * Error details for logs without request bodies. AI SDK errors carry the full prompt (invoice content)
 * in requestBodyValues; that must never end up in a log.
 */
export function safeError(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { name?: unknown; message?: unknown; statusCode?: unknown; responseBody?: unknown };
    const parts = [
      typeof e.name === "string" ? e.name : "Error",
      typeof e.statusCode === "number" ? `HTTP ${e.statusCode}` : null,
      typeof e.message === "string" ? e.message.slice(0, 300) : null,
      typeof e.responseBody === "string" ? `Antwort: ${e.responseBody.slice(0, 300)}` : null,
    ];
    return parts.filter(Boolean).join(" · ");
  }
  return String(error).slice(0, 300);
}
