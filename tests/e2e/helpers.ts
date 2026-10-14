import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Beleg } from "../../app/lib/beleg";
import { buildBeleg, type LineInput } from "../../app/lib/beleg-builder";
import type { Db } from "../../app/lib/db/client";
import * as schema from "../../app/lib/db/schema";
import { seed } from "../../app/lib/db/seed";
import { buildCiiXml } from "../../app/lib/parser/build-cii";

export const E2E_PASSWORD = "e2e-test-passwort";
export const DEMO_URL = "http://127.0.0.1:5298";

/**
 * Every spec starts from the same state: two tenants, no documents. The protocol tables refuse TRUNCATE; in replica
 * mode ordinary triggers do not fire, which only a superuser of a throwaway test database may switch on.
 */
export async function resetDb(): Promise<void> {
  // Truncates everything: only ever against the throwaway database of a test run, never a real one.
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (host !== "127.0.0.1" && host !== "localhost")
    throw new Error(`resetDb verweigert: ${host} ist keine Testdatenbank`);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query("set session_replication_role = replica");
    await pool.query(
      "truncate table reviews, decisions, bookings, exports, documents, suppliers, meta, login_attempts restart identity cascade",
    );
    await pool.query("set session_replication_role = default");
    await seed(drizzle(pool, { schema }) as unknown as Db);
  } finally {
    await pool.end();
  }
}

/** An invented invoice as an XRechnung file, ready for setInputFiles. */
export function invoiceFile(name: string, lines: LineInput[], overrides: Partial<Beleg> = {}) {
  return { name, mimeType: "application/xml", buffer: Buffer.from(buildCiiXml(buildBeleg(lines, overrides))) };
}

/** A prepared invoice as a file, for cases the builder does not produce on its own (e.g. a wrong total). */
export function belegFile(name: string, beleg: Beleg) {
  return { name, mimeType: "application/xml", buffer: Buffer.from(buildCiiXml(beleg)) };
}

export async function upload(page: Page, files: ReturnType<typeof invoiceFile>[]) {
  await page.goto("/belege");
  await page.getByLabel("Rechnungen hochladen").setInputFiles(files);
  await page.getByRole("button", { name: "Hochladen und prüfen" }).click();
  await expect(page.getByRole("status", { name: "Ergebnis des Uploads" })).toBeVisible();
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, "Seite ist breiter als der Bildschirm").toBeLessThanOrEqual(client);
}

export async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}×)`)).toEqual([]);
}
