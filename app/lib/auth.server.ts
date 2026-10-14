import { createHash, timingSafeEqual } from "node:crypto";
import { asc } from "drizzle-orm";
import { createCookieSessionStorage, redirect } from "react-router";
import type { Db } from "~/lib/db/client";
import { type Tenant, tenants } from "~/lib/db/schema";
import { holdsOnlyDemoTenants } from "~/lib/db/seed";

export function isDemo(): boolean {
  return process.env.DEMO_MODE === "true";
}

const MIN_SECRET_LENGTH = 32;
const DEV_SECRET = "nur-fuer-lokale-entwicklung-0000000";
const DEMO_SECRET = "oeffentliche-demo-ohne-login-00000000";

/** In production a missing or weak secret means no sessions at all; a known fallback would let anyone forge one. */
function sessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  // The public demo has no login and only invented tenants: its cookie holds which one you are looking at, nothing
  // worth forging. A known value is fine there and nowhere else.
  if (isDemo()) return DEMO_SECRET;
  return process.env.NODE_ENV === "production" ? null : DEV_SECRET;
}

type SessionData = { loggedIn: true; issuedAt: number; passwordVersion: string; tenantId: string };

const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7;

/** Changing APP_PASSWORD logs out every device: the only way to revoke a stateless cookie session. */
function passwordVersion(secret: string): string {
  return createHash("sha256")
    .update(`${secret}:${process.env.APP_PASSWORD ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

function sessionStorage(secret: string) {
  return createCookieSessionStorage<SessionData>({
    cookie: {
      name: "bp_session",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // E2E runs the production build over plain http; WebKit drops Secure cookies there.
      secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
      maxAge: SESSION_MAX_AGE_S,
      secrets: [secret],
    },
  });
}

function storage() {
  const secret = sessionSecret();
  if (!secret) throw new Response("Nicht eingerichtet: SESSION_SECRET fehlt.", { status: 503 });
  return sessionStorage(secret);
}

export function loginConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD) && sessionSecret() !== null;
}

export async function isLoggedIn(request: Request): Promise<boolean> {
  const secret = sessionSecret();
  if (!secret) return false;
  const session = await sessionStorage(secret).getSession(request.headers.get("Cookie"));
  const issuedAt = session.get("issuedAt");
  // The browser drops the cookie after maxAge; a copied cookie does not. The server checks the age itself.
  const fresh = typeof issuedAt === "number" && Date.now() - issuedAt < SESSION_MAX_AGE_S * 1000;
  return session.get("loggedIn") === true && fresh && session.get("passwordVersion") === passwordVersion(secret);
}

/** Hashing first makes both sides the same length, which timingSafeEqual requires, without leaking the length. */
export function passwordMatches(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function logIn(request: Request, redirectTo: string): Promise<Response> {
  const store = storage();
  const session = await store.getSession(request.headers.get("Cookie"));
  session.set("loggedIn", true);
  session.set("issuedAt", Date.now());
  session.set("passwordVersion", passwordVersion(sessionSecret() ?? DEV_SECRET));
  return redirect(safeRedirect(redirectTo), { headers: { "Set-Cookie": await store.commitSession(session) } });
}

export async function logOut(request: Request): Promise<Response> {
  const store = sessionStorage(sessionSecret() ?? DEV_SECRET);
  const session = await store.getSession(request.headers.get("Cookie"));
  return redirect("/login", { headers: { "Set-Cookie": await store.destroySession(session) } });
}

/**
 * Tenants this session may see. One password per instance means all tenants of the instance; with real users this
 * is where membership would be checked. Every tenant decision in the app goes through here.
 */
export async function allowedTenants(db: Db): Promise<Tenant[]> {
  return db.select().from(tenants).orderBy(asc(tenants.mandantenNr));
}

/**
 * The current tenant, only ever from the signed session cookie, never from URL or form. Falls back to the first
 * allowed tenant, and ignores a session value that is not (or no longer) allowed.
 */
export async function currentTenant(db: Db, request: Request): Promise<Tenant> {
  const session = await storage().getSession(request.headers.get("Cookie"));
  const wanted = session.get("tenantId");
  const allowed = await allowedTenants(db);
  const tenant = allowed.find((t) => t.id === wanted) ?? allowed[0];
  if (!tenant) throw new Response("Kein Mandant angelegt.", { status: 503 });
  return tenant;
}

/** The switcher is the one place a tenant id arrives from a form; it is checked against the allowed list. */
export async function switchTenant(db: Db, request: Request, tenantId: string, redirectTo: string): Promise<Response> {
  const allowed = await allowedTenants(db);
  if (!allowed.some((t) => t.id === tenantId)) throw new Response("Unbekannter Mandant.", { status: 400 });
  const store = storage();
  const session = await store.getSession(request.headers.get("Cookie"));
  session.set("tenantId", tenantId);
  return redirect(safeRedirect(redirectTo), { headers: { "Set-Cookie": await store.commitSession(session) } });
}

/**
 * Only same-site paths. "//evil.example" would be followed as a protocol-relative URL, and browsers strip tabs
 * and newlines first, so "/<tab>/evil.example" turns into the same thing: control characters are refused.
 */
export function safeRedirect(to: string | null | undefined): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is refused
  if (!to?.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(to)) return "/";
  const url = new URL(to, "http://same.invalid");
  if (url.origin !== "http://same.invalid") return "/";
  return url.pathname + url.search + url.hash;
}

const PUBLIC_PATHS = new Set(["/login", "/favicon.ico"]);
/** Writes the read-only demo still allows: choosing which invented company to look at. */
const DEMO_WRITES = new Set(["/mandant"]);

const DEMO_CHECK_TTL_MS = 60_000;
const demoChecks = new WeakMap<Db, { safe: boolean; at: number }>();

/**
 * The public demo drops the login, so it must never run on a database with real clients. Checked once a minute per
 * database rather than per request; the demo cannot add tenants itself, a new one only arrives with a deploy.
 */
async function demoModeSafe(db: Db): Promise<boolean> {
  const cached = demoChecks.get(db);
  if (cached && Date.now() - cached.at < DEMO_CHECK_TTL_MS) return cached.safe;
  const safe = await holdsOnlyDemoTenants(db);
  demoChecks.set(db, { safe, at: Date.now() });
  return safe;
}

/** One gate for every loader and action. Demo: read-only for everyone. Private instance: nothing without login. */
export async function guard(request: Request, db: Db): Promise<void> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\.data$/, "") || "/";
  const writing = request.method !== "GET" && request.method !== "HEAD";

  if (isDemo()) {
    // Fail closed: a misconfigured instance answers nothing instead of everything.
    if (!(await demoModeSafe(db))) {
      throw new Response("Demo-Modus verweigert: Die Datenbank enthält Mandanten außerhalb der Demo.", { status: 503 });
    }
    if (writing && !DEMO_WRITES.has(path)) throw new Response("Die Demo ist schreibgeschützt.", { status: 403 });
    if (path === "/login") throw redirect("/");
    return;
  }
  if (PUBLIC_PATHS.has(path)) return;
  if (!(await isLoggedIn(request))) {
    if (writing) throw new Response("Nicht angemeldet.", { status: 401 });
    throw redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
  }
}
