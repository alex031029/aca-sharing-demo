import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4178",
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "dotnet run --no-launch-profile --urls http://127.0.0.1:4178",
    url: "http://127.0.0.1:4178/healthz",
    env: { APP_VERSION: "v1" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
