import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, "__TAURI_OS_PLUGIN_INTERNALS__", { value: {
        platform: navigator.platform.includes("Mac") ? "macos" : "linux",
      } });
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        invoke: async (command: string): Promise<unknown> => {
          if (command === "pdf_path") return "/workshop/harbor/main.pdf";
          if (command === "get_ai_key_status") return { status: "missing" };
          if (command === "write_project_meta" || command === "write_app_data") return null;
          throw new Error(`Unexpected workshop native command: ${command}`);
        },
      } });
    });
    await use(page);
    expect(failures, "Unexpected browser exceptions").toEqual([]);
  },
});
export { expect };
