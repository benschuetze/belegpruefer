import { expect, test } from "@playwright/test";
import { DEMO_URL, E2E_PASSWORD } from "./helpers";

test.describe("ohne Login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("privat: Weiterleitung auf Login, Schreiben 401", async ({ page, request }) => {
    await page.goto("/belege");
    await expect(page).toHaveURL(/\/login\?next=%2Fbelege/);
    const post = await request.post("/belege", { headers: { Origin: "http://127.0.0.1:5299" } });
    expect(post.status()).toBe(401);
  });

  test("Login mit präparierter Weiterleitung landet auf der eigenen Seite, nicht auf einer fremden", async ({
    page,
  }) => {
    await page.goto("/login?next=/.//evil.example");
    await page.getByLabel("Passwort").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByTestId("brauchen-dich")).toBeVisible();
    expect(new URL(page.url()).host).toBe("127.0.0.1:5299");
  });

  test("Seiten mit Belegen landen in keinem gemeinsamen Cache", async ({ request }) => {
    for (const path of ["/", "/belege", "/belege.data"]) {
      const res = await request.get(`${DEMO_URL}${path}`);
      expect(res.headers()["cache-control"], path).toBe("private, no-store");
    }
  });

  test("fremde Seite darf nichts schreiben (CSRF)", async ({ request }) => {
    const post = await request.post("/login", { headers: { Origin: "https://evil.example" }, form: { password: "x" } });
    // Our middleware answers 403; React Router's own origin check may answer 400 first. Both refuse.
    expect([400, 403]).toContain(post.status());
  });

  test("Demo: lesen ohne Login, Umschalter geht, Hochladen ist 403", async ({ page, request }) => {
    await page.goto(DEMO_URL);
    await expect(page.getByText("Mockdaten")).toBeVisible();
    await expect(page.getByLabel("Rechnungen hochladen")).toBeDisabled();
    await page.getByRole("button", { name: "Rösterei Lindgrün UG" }).click();
    await expect(page.getByRole("button", { name: "Rösterei Lindgrün UG" })).toHaveAttribute("aria-pressed", "true");
    const post = await request.post(`${DEMO_URL}/belege`, { headers: { Origin: DEMO_URL } });
    expect(post.status()).toBe(403);
    const lock = await request.post(`${DEMO_URL}/export`, {
      headers: { Origin: DEMO_URL },
      form: { von: "2026-09-01", bis: "2026-09-30" },
    });
    expect(lock.status()).toBe(403);
  });
});
