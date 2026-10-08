import { expect, test } from "@playwright/test";

for (const direction of ["ltr", "rtl"] as const) {
  test.describe(direction, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/tests/browser/scroll-area.html?dir=${direction}`);
    });

    for (const name of ["fixed", "existing-padding", "both-axes", "flex"]) {
      test(`${name} keeps the vertical track outside the viewport and scrolls to the end`, async ({ page }) => {
        const root = page.getByTestId(name);
        const viewport = root.locator('[data-slot="scroll-area-viewport"]');
        const track = root.locator('[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]');
        await expect(track).toBeVisible();
        await expect.poll(() => track.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0);

        await expect.poll(() => root.evaluate((element, dir) => {
          const viewportElement = element.querySelector('[data-slot="scroll-area-viewport"]');
          const trackElement = element.querySelector('[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]');
          if (viewportElement === null || trackElement === null) throw new Error("Missing scroll-area geometry");
          const viewportBox = viewportElement.getBoundingClientRect();
          const trackBox = trackElement.getBoundingClientRect();
          return dir === "rtl" ? viewportBox.left - trackBox.right : trackBox.left - viewportBox.right;
        }, direction)).toBeGreaterThanOrEqual(-0.5);

        const vertical = await viewport.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
          return { actual: element.scrollTop, expected: element.scrollHeight - element.clientHeight };
        });
        expect(vertical.expected).toBeGreaterThan(0);
        expect(vertical.actual).toBeCloseTo(vertical.expected, 0);

        if (name === "both-axes") {
          await expect(root.locator('[data-slot="scroll-area-scrollbar"][data-orientation="horizontal"]')).toBeVisible();
          const horizontal = await viewport.evaluate((element, dir) => {
            element.scrollLeft = dir === "rtl" ? -element.scrollWidth : element.scrollWidth;
            return { actual: Math.abs(element.scrollLeft), expected: element.scrollWidth - element.clientWidth };
          }, direction);
          expect(horizontal.expected).toBeGreaterThan(0);
          expect(horizontal.actual).toBeCloseTo(horizontal.expected, 0);
        }
      });
    }

    test("showing and hiding the scrollbar preserves viewport geometry", async ({ page }) => {
      const root = page.getByTestId("overflow-toggle");
      const viewport = root.locator('[data-slot="scroll-area-viewport"]');
      const track = root.locator('[data-slot="scroll-area-scrollbar"]');
      const content = page.getByTestId("resizable-content");
      await expect(content).toBeVisible();
      await expect(track).toBeHidden();
      const before = await viewport.boundingBox();
      expect(before).not.toBeNull();

      await content.evaluate((element) => element.classList.replace("h-24", "h-96"));
      await expect(track).toBeVisible();
      expect(await viewport.boundingBox()).toEqual(before);

      await content.evaluate((element) => element.classList.replace("h-96", "h-24"));
      await expect(track).toBeHidden();
      expect(await viewport.boundingBox()).toEqual(before);
    });

    test("an auto-height area fits its content without vertical overflow", async ({ page }) => {
      const root = page.getByTestId("auto-height");
      const viewport = root.locator('[data-slot="scroll-area-viewport"]');
      await expect(viewport).toBeVisible();
      await expect(root.locator('[data-slot="scroll-area-scrollbar"]')).toBeHidden();
      const size = await viewport.evaluate((element) => ({ height: element.clientHeight, contentHeight: element.scrollHeight }));
      expect(size.height).toBeGreaterThan(0);
      expect(size.height).toBe(size.contentHeight);
    });
  });
}
