import { expect, test } from "@playwright/test";
import {
  collectConsoleErrors,
  expectNoHorizontalOverflow,
  expectNoSeriousA11yViolations,
  invoiceFile,
  resetDb,
  upload,
} from "./helpers";

test.beforeAll(resetDb);

test("jede Seite: keine Konsolenfehler, kein Überlauf, axe ohne schwere Verstöße, hell und dunkel", async ({
  page,
}) => {
  await upload(page, [invoiceFile("bistro.xml", [{ description: "2 × Mittagsmenü", netCents: 3780 }])]);
  await page.goto("/belege");
  await page.getByTestId("beleg").click();
  await expect(page).toHaveURL(/\/belege\/[0-9a-f-]{36}$/);
  const detail = new URL(page.url()).pathname;

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ["/", "/belege", detail, "/protokoll", "/export", "/eval"]) {
      const errors = collectConsoleErrors(page);
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoSeriousA11yViolations(page);
      expect(errors, `${path} (${scheme})`).toEqual([]);
    }
  }
});

test("Hauptaktion per Tastatur: Upload-Knopf und Mandanten-Umschalter sind echte Knöpfe", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Hochladen und prüfen" })).toBeVisible();
  const chip = page.getByRole("button", { name: "Rösterei Lindgrün UG" });
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
});
