import { expect, test } from "@playwright/test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Db } from "../../app/lib/db/client";
import * as schema from "../../app/lib/db/schema";
import { DEMO_TENANTS } from "../../app/lib/db/seed";
import { storeUpload } from "../../app/lib/documents.server";
import { DEMO_URL, invoiceFile, resetDb } from "./helpers";

test.beforeEach(resetDb);

test("viele Belege: Upload antwortet sofort, die Seite arbeitet die Warteschlange ab, jeder Beleg kommt an", async ({
  page,
}) => {
  const files = Array.from({ length: 8 }, (_, i) =>
    invoiceFile(`stapel-${i + 1}.xml`, [{ description: `Kopierpapier Lieferung ${i + 1}`, netCents: 1000 + i }], {
      invoiceNumber: `ST-${i + 1}`,
    }),
  );
  await page.goto("/belege");
  await page.getByLabel("Rechnungen hochladen").setInputFiles(files);
  await page.getByRole("button", { name: "Hochladen und prüfen" }).click();
  const result = page.getByRole("status", { name: "Ergebnis des Uploads" });
  await expect(result).toBeVisible();
  await expect(page.getByRole("status", { name: "Warteschlange" })).toBeHidden({ timeout: 30_000 });
  // Every file ends in a final state; none stays "wartet" or "wird geprüft".
  for (const file of files) {
    await expect(result).toContainText(new RegExp(`${file.name}: (automatisch gebucht|braucht dich)`));
  }
  await expect(page.getByTestId("beleg")).toHaveCount(8);
});

test("mehr als 4 MB auf einmal: der Browser sagt es vorher, statt dass der Server abbricht", async ({ page }) => {
  await page.goto("/belege");
  const big = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.alloc(2_500_000, 0x20) });
  await page.getByLabel("Rechnungen hochladen").setInputFiles([big("a.pdf"), big("b.pdf")]);
  await expect(page.getByText("Zusammen mehr als 4 MB")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hochladen und prüfen" })).toBeDisabled();
});

test("mehr als 4 MB an den Server: abgelehnt mit 413, nichts angelegt", async ({ page, request }) => {
  const big = { name: "gross.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(4_300_000, 0x20) };
  const res = await request.post("/belege", {
    headers: { Origin: "http://127.0.0.1:5299" },
    multipart: { files: big },
  });
  expect(res.status()).toBe(413);
  await page.goto("/belege");
  await expect(page.getByTestId("beleg")).toHaveCount(0);
});

test("Demo mit wartendem Beleg: Seite bleibt lesbar, und die schreibgeschützte Demo ruft nichts zum Verarbeiten auf", async ({
  page,
}) => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const file = invoiceFile("wartet.xml", [{ description: "Kopierpapier", netCents: 1000 }]);
    await storeUpload(drizzle(pool, { schema }) as unknown as Db, DEMO_TENANTS[0].id, file.name, file.buffer);
  } finally {
    await pool.end();
  }
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/verarbeiten")) calls.push(r.url());
  });
  await page.goto(`${DEMO_URL}/belege`);
  await expect(page.getByRole("heading", { name: "Belege" })).toBeVisible();
  await expect(page.getByTestId("beleg")).toHaveCount(1);
  await expect(page.getByRole("status", { name: "Warteschlange" })).toHaveCount(0);
  // Long enough for the poller's first round, which starts immediately when it runs at all.
  await page.waitForTimeout(1500);
  expect(calls).toEqual([]);
});
