import { expect, test } from "./fixtures";

for (const width of [1280, 480]) {
  test.describe(`review card at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const surface of ["planner", "sidebar"]) {
      test(`${surface} aligns the plan card with the composer`, async ({ page }, testInfo) => {
        await page.goto("/tests/browser/agent-review-tray.html");
        const panel = page.getByTestId(surface);
        const card = panel.locator("[data-agent-review-tray]");
        const input = panel.getByRole("region", { name: "Agent composer" }).locator('[data-slot="input-group"]');
        await expect(card.getByRole("button", { name: "Review changes" })).toBeVisible();
        await expect(input).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath("plan-card-padding.png"), fullPage: true });

        const cardBox = await card.boundingBox();
        const inputBox = await input.boundingBox();
        if (cardBox === null || inputBox === null) throw new Error("Missing plan card or composer geometry");
        expect(Math.abs(cardBox.x - inputBox.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(cardBox.x + cardBox.width - inputBox.x - inputBox.width)).toBeLessThanOrEqual(0.5);
        const overflow = await panel.evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }

    test("keeps preview names within two compact lines", async ({ page }) => {
      await page.goto("/tests/browser/agent-review-tray.html");
      await page.evaluate(() => document.fonts.ready);
      for (const surface of ["planner", "sidebar"]) {
        const title = page.getByTestId(surface).locator('[data-agent-review-tray] [data-slot="card-title"]');
        await expect(title).toBeVisible();
        const box = await title.boundingBox();
        if (box === null) throw new Error("Missing review card title geometry");
        expect(box.height).toBeLessThanOrEqual(40);
      }
      const names = page.getByTestId("changes").locator('[aria-label="Saved drafts"] small');
      for (const name of await names.all()) {
        const box = await name.boundingBox();
        if (box === null) throw new Error("Missing saved draft name geometry");
        expect(box.height).toBeLessThanOrEqual(40);
      }
    });

    test("gives the full plan name compact type and its own row above actions", async ({ page }, testInfo) => {
      await page.goto("/tests/browser/agent-review-tray.html");
      const changes = page.getByTestId("changes");
      const preview = changes.locator('[data-draft-preview="plan-sidebar"]');
      const title = preview.getByRole("heading", { level: 2 });
      await expect(title).toContainText("leaves the mechanism uncertain.");
      await page.screenshot({ path: testInfo.outputPath("plan-card-type.png"), fullPage: true });
      const fontSize = await title.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
      expect(fontSize).toBeLessThanOrEqual(14);
      const titleBox = await title.boundingBox();
      const previewBox = await preview.boundingBox();
      const actionsBox = await preview.locator('[aria-label="Draft actions"]').boundingBox();
      if (titleBox === null || previewBox === null || actionsBox === null) throw new Error("Missing draft header geometry");
      expect(Math.abs(titleBox.width - previewBox.width)).toBeLessThanOrEqual(0.5);
      expect(titleBox.height).toBeLessThanOrEqual(120);
      expect(actionsBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    });

    test("keeps planning text compact while preserving the manuscript and overview text size", async ({ page }) => {
      await page.goto("/tests/browser/agent-review-tray.html");
      const changes = page.getByTestId("changes");
      const planningText = changes.locator('[data-agent-change-id="planning-change"] [data-slot="card-content"] p');
      await expect(planningText).toContainText("Anchor the reunion");
      const planSize = await planningText.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
      expect(planSize).toBeLessThanOrEqual(14);

      await changes.getByRole("button", { name: /Review manuscript prose/ }).click();
      const manuscriptText = changes.locator('[data-agent-change-id="manuscript-change"] [data-slot="card-content"] p');
      await expect(manuscriptText).toContainText("station clock");
      expect(await manuscriptText.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBe(28);

      await changes.getByRole("button", { name: /Review story overview/ }).click();
      const overviewText = changes.locator('[data-agent-change-id="overview-change"] [data-slot="card-content"] p');
      await expect(overviewText).toContainText("A reunion tests an old friendship");
      expect(await overviewText.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBe(28);
    });
  });
}

for (const width of [320, 480]) {
  test(`character revisions scroll and contain actions at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 600 });
    await page.goto("/tests/browser/agent-review-tray.html?characters");
    const panel = page.getByRole("region", { name: "Changes" });
    await expect(panel.getByRole("button", { name: "Pending drafts (5)" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const viewport = panel.locator('[data-slot="scroll-area-viewport"]');
    expect(await viewport.evaluate((element) => element.scrollHeight)).toBeGreaterThan(600);
    for (const name of ["Two unidentified men", "Raul Pizano", "Unnamed bagel-counter woman"]) {
      const add = panel.getByRole("button", { name: `Add ${name}`, exact: true });
      const dismiss = panel.getByRole("button", { name: `Dismiss ${name}`, exact: true });
      await add.scrollIntoViewIfNeeded();
      await expect(add).toBeInViewport();
      await expect(dismiss).toBeInViewport();
      const bounds = await panel.boundingBox();
      if (bounds === null) throw new Error("Missing Changes panel geometry");
      for (const button of [add, dismiss]) {
        const box = await button.boundingBox();
        if (box === null) throw new Error("Missing candidate action geometry");
        expect(box.x).toBeGreaterThanOrEqual(bounds.x);
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      }
    }
    expect(await viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await viewport.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("character-review-actions.png") });
    await panel.getByRole("button", { name: "Add Unnamed bagel-counter woman", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Add Unnamed bagel-counter woman", exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Dismiss Raul Pizano", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Dismiss Raul Pizano", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /Review new characters/ })).toContainText("1 pending");
    await panel.getByRole("button", { name: "Dismiss Two unidentified men", exact: true }).click();
    await expect(panel.getByText("No pending characters")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Pending drafts (4)" })).toBeVisible();
  });
}
