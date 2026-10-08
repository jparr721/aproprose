import { defineConfig, devices } from "@playwright/test";

function runnerIdentity(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin": return "(Macintosh; Intel Mac OS X 10_15_7)";
    case "linux": return "(X11; Linux x86_64)";
    case "win32": return "(Windows NT 10.0; Win64; x64)";
    default: throw new Error(`Browser tests do not support ${platform}`);
  }
}

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
    {
      name: "webkit",
      use: {
        browserName: "webkit",
        userAgent: devices["Desktop Safari"].userAgent.replace(/\([^)]*\)/, runnerIdentity(process.platform)),
      },
    },
  ],
  webServer: {
    command: "just dev-browser",
    url: "http://127.0.0.1:1432/tests/browser/scroll-area.html?dir=ltr",
    reuseExistingServer: false,
  },
});
