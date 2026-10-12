import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../tests/helpers/db";
import { currentTenant, guard, isLoggedIn, switchTenant } from "./auth.server";
import { DEMO_TENANTS } from "./db/seed";

afterEach(() => vi.unstubAllEnvs());

async function status(request: Request): Promise<number | "ok"> {
  try {
    await guard(request);
    return "ok";
  } catch (e) {
    if (e instanceof Response) return e.status;
    throw e;
  }
}

describe("Zugang", () => {
  it("Demo: lesen ohne Login, schreiben nur der Mandanten-Umschalter", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    expect(await status(new Request("http://x/belege"))).toBe("ok");
    expect(await status(new Request("http://x/belege", { method: "POST" }))).toBe(403);
    expect(await status(new Request("http://x/export.data", { method: "POST" }))).toBe(403);
    expect(await status(new Request("http://x/mandant", { method: "POST" }))).toBe("ok");
  });

  it("privat ohne Login: Weiterleitung beim Lesen, 401 beim Schreiben", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    expect(await status(new Request("http://x/belege"))).toBe(302);
    expect(await status(new Request("http://x/belege", { method: "POST" }))).toBe(401);
  });

  it("Demo in Produktion ohne SESSION_SECRET: Umschalter funktioniert, ein Login gibt es trotzdem nicht", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("SESSION_SECRET", "");
    const { db } = await createTestDb();
    const switched = await switchTenant(db, new Request("http://x/mandant"), DEMO_TENANTS[1].id, "/");
    const cookie = switched.headers.get("Set-Cookie")?.split(";")[0] ?? "";
    const tenant = await currentTenant(db, new Request("http://x/", { headers: { Cookie: cookie } }));
    expect(tenant.id).toBe(DEMO_TENANTS[1].id);
    expect(await isLoggedIn(new Request("http://x/", { headers: { Cookie: cookie } }))).toBe(false);
  });

  it("private Instanz in Produktion ohne SESSION_SECRET: keine Sessions", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("SESSION_SECRET", "");
    const { db } = await createTestDb();
    await expect(switchTenant(db, new Request("http://x/mandant"), DEMO_TENANTS[1].id, "/")).rejects.toMatchObject({
      status: 503,
    });
  });
});
