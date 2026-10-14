import { afterEach, describe, expect, it, vi } from "vitest";
import { applySecurityHeaders, contentSecurityPolicy, hashIp, isCrossSiteWrite, safeError } from "./security.server";

afterEach(() => vi.unstubAllEnvs());

const post = (headers: Record<string, string>) =>
  new Request("https://app.example/import", { method: "POST", headers });

describe("CSRF: isCrossSiteWrite", () => {
  it("lässt Lesezugriffe immer durch", () => {
    expect(isCrossSiteWrite(new Request("https://app.example/", { headers: { "Sec-Fetch-Site": "cross-site" } }))).toBe(
      false,
    );
  });
  it.each([
    [{ "Sec-Fetch-Site": "same-origin" }, false],
    [{ "Sec-Fetch-Site": "none" }, false],
    [{ "Sec-Fetch-Site": "cross-site" }, true],
    [{ "Sec-Fetch-Site": "same-site" }, true],
    [{ Origin: "https://app.example" }, false],
    [{ Origin: "https://evil.example" }, true],
    [{ Origin: "https://app.example.evil.example" }, true],
    [{ Origin: "null" }, true],
    [{ Referer: "https://app.example/import" }, false],
    [{ Referer: "https://evil.example/app.example" }, true],
    [{ Referer: "kaputt" }, true],
    [{}, true],
  ])("%j → abgelehnt: %s", (headers, rejected) => {
    expect(isCrossSiteWrite(post(headers as Record<string, string>))).toBe(rejected);
  });
  it("Fetch Metadata hat Vorrang vor einem passenden Origin", () => {
    expect(isCrossSiteWrite(post({ "Sec-Fetch-Site": "cross-site", Origin: "https://app.example" }))).toBe(true);
  });
});

describe("Header", () => {
  it("setzt die Schutz-Header", () => {
    const h = new Headers();
    applySecurityHeaders(h);
    expect(h.get("Strict-Transport-Security")).toContain("max-age=63072000");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Referrer-Policy")).toBe("no-referrer");
    expect(h.get("X-Robots-Tag")).toContain("noindex");
  });
  it("CSP erlaubt nur Skripte mit Nonce und verbietet Einbetten", () => {
    const csp = contentSecurityPolicy("abc");
    expect(csp).toContain("script-src 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
  });
  it("CSP lässt Daten nur zum eigenen Server: keine fremden Verbindungen, Bilder, Schriften oder Frames", () => {
    const csp = contentSecurityPolicy("abc");
    // Injected markup could otherwise send data out through an image URL or a fetch to another host.
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("media-src 'self'");
  });
});

describe("Logs ohne Belegdaten", () => {
  it("safeError lässt den Anfragetext eines KI-Fehlers weg", () => {
    const apiError = Object.assign(new Error("Bad Request"), {
      name: "AI_APICallError",
      statusCode: 400,
      responseBody: '{"error":"invalid_request_error"}',
      requestBodyValues: { messages: [{ content: "Papierwerk Sommer KG, Rechnung PW-2026-0815, 148.60 EUR" }] },
    });
    const logged = safeError(apiError);
    expect(logged).toBe('AI_APICallError · HTTP 400 · Bad Request · Antwort: {"error":"invalid_request_error"}');
    expect(logged).not.toMatch(/Papierwerk|PW-2026|148\.60/);
  });
});

describe("IP-Hash", () => {
  it("speichert keine IP im Klartext und hängt vom Secret ab", () => {
    vi.stubEnv("SESSION_SECRET", "a".repeat(32));
    const a = hashIp("203.0.113.7");
    expect(a).not.toContain("203.0.113.7");
    vi.stubEnv("SESSION_SECRET", "b".repeat(32));
    expect(hashIp("203.0.113.7")).not.toBe(a);
  });
});
