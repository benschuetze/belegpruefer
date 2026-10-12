import { expect, test } from "@playwright/test";
import { invoiceFile, resetDb, upload } from "./helpers";

test.beforeEach(resetDb);

test("Mandanten sind getrennt: Beleg von A ist bei B weder in der Liste noch per Link erreichbar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Feldbach Design GmbH" }).click();
  await upload(page, [invoiceFile("a.xml", [{ description: "Kopierpapier", netCents: 5000 }])]);
  await page.getByRole("status", { name: "Ergebnis des Uploads" }).getByRole("link", { name: "ansehen" }).click();
  await expect(page).toHaveURL(/\/belege\/[0-9a-f-]{36}$/);
  const url = page.url();

  await page.getByRole("button", { name: "Rösterei Lindgrün UG" }).click();
  await expect(page.getByRole("button", { name: "Rösterei Lindgrün UG" })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/belege");
  await expect(page.getByTestId("beleg")).toHaveCount(0);

  const response = await page.goto(url);
  expect(response?.status()).toBe(404);
  const file = await page.request.get(`${url}/datei`);
  expect(file.status()).toBe(404);

  await page.goto("/");
  await page.getByRole("button", { name: "Feldbach Design GmbH" }).click();
  await expect(page.getByRole("button", { name: "Feldbach Design GmbH" })).toHaveAttribute("aria-pressed", "true");
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Papierwerk Sommer KG");
});

test("eine Mandanten-ID aus Formular oder URL wird nicht übernommen, wenn sie nicht erlaubt ist", async ({ page }) => {
  await page.goto("/");
  const response = await page.request.post("/mandant", {
    form: { tenantId: "11111111-1111-4111-8111-111111111111", next: "/" },
    headers: { Origin: "http://127.0.0.1:5299" },
  });
  expect(response.status()).toBe(400);
  await page.goto("/?tenantId=00000000-0000-4000-8000-000000000002");
  await expect(page.getByRole("button", { name: "Feldbach Design GmbH" })).toHaveAttribute("aria-pressed", "true");
});
