import { expect, test } from "@playwright/test";
import { invoiceFile, resetDb } from "./helpers";

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
