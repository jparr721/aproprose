import { test, expect } from "./fixtures";

test("browser shortcuts and the native fixture use the runner OS", async ({ page }) => {
  await page.goto("/tests/workshop.html");
  const identity = await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "__TAURI_OS_PLUGIN_INTERNALS__");
    if (descriptor === undefined) throw new Error("Native platform fixture is missing");
    const native: unknown = descriptor.value;
    if (native === null || typeof native !== "object" || !("platform" in native)) {
      throw new Error("Native platform fixture is invalid");
    }
    return { usesMeta: /mac/i.test(navigator.userAgent), platform: native.platform };
  });
  expect(identity.usesMeta).toBe(process.platform === "darwin");
  expect(identity.platform).toBe(process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux");
});

for (const width of [960, 1440]) {
  test(`workspace and find widgets fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/tests/workshop.html");
    const editor = page.locator('[data-search-surface="editor"]');
    await expect(editor).toBeVisible();
    for (const theme of ["light", "sepia", "dark"] as const) {
      await page.evaluate((value) => window.workshop.setTheme(value), theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect.poll(async () => {
        const box = await editor.boundingBox();
        return box === null ? 0 : box.width;
      }).toBeGreaterThanOrEqual(350);
      for (const surface of ["editor", "pdf"] as const) {
        await page.evaluate((value) => window.workshop.openFind(value), surface);
        const pane = page.locator(`[data-search-surface="${surface}"]`);
        const widget = pane.locator("[data-find-widget]");
        await expect(widget).toBeVisible();
        const bounds = await pane.boundingBox();
        const find = await widget.boundingBox();
        expect(find).not.toBeNull();
        expect(bounds).not.toBeNull();
        expect(find!.x).toBeGreaterThanOrEqual(bounds!.x);
        expect(find!.x + find!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  });
}

test("outline focus owns undo and returning to the editor restores its shortcut", async ({ page }) => {
  await page.goto("/tests/workshop.html");
  await page.evaluate(() => {
    window.workshop.editManuscript();
    window.workshop.setPanels({ aiOpen: false, pdfOpen: false, outlineOpen: true, focus: false });
  });
  const overview = page.getByPlaceholder("What is this book about?");
  await expect(overview).toBeVisible();
  await overview.pressSequentially("A writer returns home");
  await expect(overview).toHaveValue("A writer returns home");
  await overview.press("ControlOrMeta+z");
  await expect(overview).not.toHaveValue("A writer returns home");
  expect(await page.evaluate(() => window.workshop.manuscriptText())).toBe("Edited manuscript");
  await page.evaluate(() => window.workshop.setPanels({ aiOpen: false, pdfOpen: false, outlineOpen: false, focus: false }));
  await expect(page.locator('[data-search-surface="editor"]')).toBeVisible();
  await page.locator('[data-search-surface="editor"]').getByText("Edited manuscript", { exact: true }).dblclick();
  await expect(page.locator('[data-prose-body]')).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => page.evaluate(() => window.workshop.manuscriptText())).toContain("The harbor was quiet");
});

test("failed AI hydration exposes a contained reset action without a loading spinner", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 820 });
  await page.goto("/tests/workshop.html");
  await page.evaluate(() => window.workshop.setAgentFailure("load"));
  const section = page.getByRole("region", { name: "AI Console" });
  await expect(section.getByText("AI conversation could not be loaded.")).toBeVisible();
  await expect(section.getByText("Loading AI conversation")).toHaveCount(0);
  await expect(section.locator('[data-slot="spinner"]')).toHaveCount(0);
  const action = section.getByRole("button", { name: "Reset AI Conversation" });
  await expect(action).toBeVisible();
  const sectionBox = await section.boundingBox();
  const actionBox = await action.boundingBox();
  expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(sectionBox!.x + sectionBox!.width);
  await action.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("settings controls have names and theme and schedule changes work", async ({ page }) => {
  await page.goto("/tests/workshop.html?surface=settings");
  await expect(page.getByRole("slider", { name: "Prose size" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "AI provider" })).toBeVisible();
  await expect(page.getByLabel("OpenAI key", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  const schedule = page.getByRole("switch", { name: "Auto-sync this project" });
  await schedule.click();
  await expect(page.getByRole("slider", { name: "Backup interval" })).toBeDisabled();
});
