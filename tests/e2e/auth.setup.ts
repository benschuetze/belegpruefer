import { expect, test as setup } from "@playwright/test";
import { E2E_PASSWORD } from "./helpers";

setup("anmelden", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Passwort").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByTestId("brauchen-dich")).toBeVisible();
  await page.context().storageState({ path: "playwright/.auth/state.json" });
});
