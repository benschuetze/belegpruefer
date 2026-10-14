/**
 * Screenshots of the public demo for the README. Light mode, desktop, plus one phone shot at night.
 *
 *   pnpm tsx scripts/screenshots.ts [https://belegpruefer-demo.vercel.app]
 */
import { chromium, devices } from "@playwright/test";

const base = process.argv[2] ?? "https://belegpruefer-demo.vercel.app";
const out = (name: string) => new URL(`../docs/screenshots/${name}.png`, import.meta.url).pathname;

const browser = await chromium.launch();
const desktop = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  colorScheme: "light",
  deviceScaleFactor: 1,
});
const page = await desktop.newPage();

await page.goto(`${base}/`);
await page.screenshot({ path: out("start"), fullPage: false });

// The invoice that tries to instruct the bookkeeping: proposal, objection, findings side by side.
await page.goto(`${base}/belege?filter=pruefen`);
await page.getByTestId("beleg").filter({ hasText: "Druckerei Halbmond" }).click();
await page.waitForURL(/\/belege\/[0-9a-f-]{36}$/);
await page.screenshot({ path: out("pruefen"), fullPage: true });

await page.goto(`${base}/eval`);
await page.screenshot({ path: out("eval"), fullPage: true });

await page.goto(`${base}/protokoll`);
await page.screenshot({ path: out("protokoll"), fullPage: false });

await page.goto(`${base}/export?von=2026-08-01&bis=2026-08-31`);
await page.screenshot({ path: out("export"), fullPage: false });

const phone = await browser.newContext({ ...devices["iPhone 13"], colorScheme: "dark" });
const mobile = await phone.newPage();
await mobile.goto(`${base}/`);
await mobile.screenshot({ path: out("handy-nacht"), fullPage: false });

await browser.close();
console.log("Screenshots in docs/screenshots/");
