import { expect, test } from "@playwright/test";

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
  });
}
