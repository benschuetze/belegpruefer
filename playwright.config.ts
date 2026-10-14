import { defineConfig, devices } from "@playwright/test";
import { E2E_PASSWORD } from "./tests/e2e/helpers";

const CI = !!process.env.CI;
const PORT = 5299;
const DEMO_PORT = 5298;
const LOCAL_DB_PORT = 5334;

// CI brings a real Postgres service; locally PGlite stands in so nobody needs Postgres installed.
const DATABASE_URL = process.env.DATABASE_URL ?? `postgres://postgres@127.0.0.1:${LOCAL_DB_PORT}/postgres`;
process.env.DATABASE_URL = DATABASE_URL;

const appEnv = {
  DATABASE_URL,
  // The agents answer from a keyword table: deterministic, offline, free. The real model only runs in `pnpm eval`.
  AI_MOCK: "1",
  APP_PASSWORD: E2E_PASSWORD,
  SESSION_SECRET: "e2e-session-secret-nur-fuer-tests-000000",
  NODE_ENV: "production",
  INSECURE_COOKIES: "1",
  // Locally the database is PGlite, one backend for all connections; CI keeps real parallelism against Postgres.
  ...(CI ? {} : { DATABASE_POOL_MAX: "1" }),
};

export default defineConfig({
  testDir: "tests/e2e",
  // One shared database: files run one after another, each starts by resetting it.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "playwright/.auth/state.json",
      },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], storageState: "playwright/.auth/state.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    ...(CI
      ? []
      : [
          {
            command: `pnpm exec tsx scripts/local-db.ts --memory --port ${LOCAL_DB_PORT}`,
            port: LOCAL_DB_PORT,
            reuseExistingServer: false,
            timeout: 60_000,
          },
        ]),
    {
      command: "pnpm build && pnpm exec react-router-serve ./build/server/index.js",
      url: `http://127.0.0.1:${PORT}/login`,
      env: { ...appEnv, PORT: String(PORT) },
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
    {
      command: "pnpm exec react-router-serve ./build/server/index.js",
      // A static file: pages answer 503 until a test has marked the shared database as a demo database.
      url: `http://127.0.0.1:${DEMO_PORT}/favicon.svg`,
      env: { ...appEnv, PORT: String(DEMO_PORT), DEMO_MODE: "true" },
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
