import { expect, test } from "@playwright/test";
import { invoiceFile, resetDb, upload } from "./helpers";

test.beforeEach(resetDb);

test("Festschreiben, dann DATEV-Datei: EXTF-Kopf, Windows-1252, Umlaute; danach nur noch Storno", async ({ page }) => {
  await upload(page, [
    invoiceFile("papier.xml", [{ description: "Kopierpapier und Ordner für das Büro", netCents: 10000 }], {
      invoiceNumber: "PW-0815",
      issueDate: "2026-09-03",
      supplier: {
        name: "Papierwerk Sommer & Söhne KG",
        street: "Mühlenweg 12",
        city: "Kassel",
        country: "DE",
        vatId: "DE123456789",
      },
    }),
  ]);
  await page.goto("/export?von=2026-09-01&bis=2026-09-30");
  await expect(page.getByTestId("export-zeile")).toHaveCount(1);
  await expect(page.getByTestId("export-summe")).toHaveText("119,00 €");
  await expect(page.getByRole("link", { name: "DATEV-Datei herunterladen" })).toHaveCount(0);

  await page.getByRole("button", { name: "Zeitraum festschreiben" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "DATEV-Datei herunterladen" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("EXTF_Buchungsstapel_10001_20260901_20260930.csv");
  const bytes = await (await file.createReadStream()).toArray();
  const buffer = Buffer.concat(bytes);
  const text = buffer.toString("latin1");
  expect(text.startsWith('"EXTF";700;21;"Buchungsstapel";13;')).toBe(true);
  expect(text).toContain(
    '119,00;"S";"EUR";;;"";4930;1600;"9";0309;"PW-0815";"";;"Papierwerk Sommer & Söhne KG PW-0815"',
  );
  // ö as one byte (0xF6), not as UTF-8 (0xC3 0xB6).
  expect(buffer.includes(Buffer.from([0xf6]))).toBe(true);
  expect(buffer.includes(Buffer.from([0xc3, 0xb6]))).toBe(false);

  await page.goto("/belege?filter=festgeschrieben");
  await page.getByTestId("beleg").click();
  await expect(page.getByRole("button", { name: "Passt, buchen" })).toHaveCount(0);
  await page.getByText("Korrigieren mit Storno").click();
  await page.getByLabel("Konto").selectOption("3400");
  await page.getByRole("button", { name: "Stornieren und neu buchen" }).click();
  const booked = page.getByTestId("buchungen");
  await expect(booked).toContainText("Storno 4930 Bürobedarf");
  await expect(booked).toContainText("−119,00 €");
  await expect(booked).toContainText("3400 Wareneingang 19 % Vorsteuer");
});

test("Festschreiben verweigert, solange im Zeitraum etwas offen ist", async ({ page }) => {
  await upload(page, [
    invoiceFile("bistro.xml", [{ description: "2 × Mittagsmenü", netCents: 3780 }], { issueDate: "2026-09-12" }),
    invoiceFile("papier.xml", [{ description: "Kopierpapier", netCents: 5000 }], {
      invoiceNumber: "P-2",
      issueDate: "2026-09-13",
    }),
  ]);
  await page.goto("/export?von=2026-09-01&bis=2026-09-30");
  await expect(page.getByText("1 Beleg(e) aus diesem Zeitraum sind noch offen.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zeitraum festschreiben" })).toBeDisabled();
});
