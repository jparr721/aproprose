import { test as base, expect } from "@playwright/test";

function nativePlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin": return "macos";
    case "linux": return "linux";
    case "win32": return "windows";
    default: throw new Error(`Browser tests do not support ${platform}`);
  }
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.addInitScript((platform: string) => {
      Object.defineProperty(window, "__TAURI_OS_PLUGIN_INTERNALS__", { value: {
        platform,
      } });
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        invoke: async (command: string): Promise<unknown> => {
          if (command === "pdf_path") return "/workshop/harbor/main.pdf";
          if (command === "get_ai_key_status") return { status: "missing" };
          if (command === "write_project_meta" || command === "write_app_data") return null;
          throw new Error(`Unexpected workshop native command: ${command}`);
        },
      } });
    }, nativePlatform(process.platform));
    await use(page);
    expect(failures, "Unexpected browser exceptions").toEqual([]);
  },
});
export { expect };
