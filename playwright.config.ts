import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  forbidOnly: Boolean(process.env.CI),
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:1432",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "bun run dev --host 127.0.0.1 --port 1432",
    url: "http://127.0.0.1:1432/tests/browser/scroll-area.html?dir=ltr",
    reuseExistingServer: false,
  },
});
