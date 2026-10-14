import { expect, test } from "@playwright/test";
import { invoiceFile, resetDb, upload } from "./helpers";

test.beforeEach(resetDb);

test("lange Positionstexte bleiben in der Belegkarte und brechen um", async ({ page }) => {
  const long =
    "Flyer A5, 2000 Stück, beidseitig bedruckt, 135 g Bilderdruck matt, Lieferung an die Geschäftsadresse, Hinweis an die Buchhaltung bitte beachten";
  await upload(page, [invoiceFile("lang.xml", [{ description: long, netCents: 18900 }])]);
  await page.getByRole("status", { name: "Ergebnis des Uploads" }).getByRole("link", { name: "ansehen" }).click();
  await expect(page).toHaveURL(/\/belege\/[0-9a-f-]{36}$/);

  const card = page.getByRole("region", { name: "Beleg" });
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("Belegkarte ohne Fläche");
  const overflow = await page
    .getByTestId("position")
    .evaluateAll(
      (lines, right) =>
        lines
          .map((l) => Math.max(...[...l.querySelectorAll("*")].map((c) => c.getBoundingClientRect().right)))
          .filter((r) => r > right + 1),
      cardBox.x + cardBox.width,
    );
  expect(overflow, "Text ragt über den rechten Rand der Belegkarte").toEqual([]);
  await expect(page.getByTestId("position").getByText("189,00 €")).toBeVisible();
});
