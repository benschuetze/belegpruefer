import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { resetDb } from "./helpers";

test.beforeEach(resetDb);

test("XRechnung hochladen: automatisch gebucht, Buchungen und Protokoll sichtbar, zweiter Upload ist Duplikat", async ({
  page,
}) => {
  const file = {
    name: "xrechnung-papierwerk.xml",
    mimeType: "application/xml",
    buffer: readFileSync("app/lib/parser/__fixtures__/xrechnung-papierwerk.xml"),
  };
  await page.goto("/belege");
  await page.getByLabel("Rechnungen hochladen").setInputFiles(file);
  await page.getByRole("button", { name: "Hochladen und prüfen" }).click();
  const result = page.getByRole("status", { name: "Ergebnis des Uploads" });
  await expect(result).toContainText("xrechnung-papierwerk.xml: automatisch gebucht");

  await result.getByRole("link", { name: "ansehen" }).click();
  await expect(page.getByRole("heading", { name: "Papierwerk Sommer KG" })).toBeVisible();
  const booked = page.getByTestId("buchungen");
  await expect(booked).toContainText("4930 Bürobedarf an 1600, BU 9");
  await expect(booked).toContainText("118,64 €");
  await expect(booked).toContainText("4940 Zeitschriften, Bücher an 1600, BU 8");
  await expect(booked).toContainText("29,96 €");
  const run = page.getByTestId("protokoll-lauf");
  for (const step of ["Parser", "Validator", "Recherche", "Kontierer", "Prüfer", "Entscheidung"]) {
    await expect(run.getByText(step, { exact: true })).toBeVisible();
  }
  await expect(run).toContainText("kontierer-2026-");

  await page.goto("/");
  await expect(page.getByTestId("brauchen-dich")).toHaveText("0");
  await expect(page.getByTestId("eingegangen")).toContainText("1");

  await page.goto("/belege");
  await page.getByLabel("Rechnungen hochladen").setInputFiles({ ...file, name: "nochmal.xml" });
  await page.getByRole("button", { name: "Hochladen und prüfen" }).click();
  await expect(page.getByRole("status", { name: "Ergebnis des Uploads" })).toContainText(
    "nochmal.xml: schon vorhanden",
  );
  await expect(page.getByTestId("beleg")).toHaveCount(1);
});

test("keine Datei bleibt ohne Antwort: kaputtes XML und Bild werden mit Grund abgelehnt", async ({ page }) => {
  await page.goto("/belege");
  await page.getByLabel("Rechnungen hochladen").setInputFiles([
    { name: "ubl.xml", mimeType: "application/xml", buffer: Buffer.from('<?xml version="1.0"?><Invoice/>') },
    { name: "foto.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) },
  ]);
  await page.getByRole("button", { name: "Hochladen und prüfen" }).click();
  const result = page.getByRole("status", { name: "Ergebnis des Uploads" });
  await expect(result).toContainText("ubl.xml: nicht lesbar");
  await expect(result).toContainText("foto.png: abgelehnt, Weder XML noch PDF");
  await page.goto("/belege?filter=pruefen");
  await expect(page.getByTestId("beleg")).toContainText("UBL-Rechnungen werden noch nicht unterstützt");
});
