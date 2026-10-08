/**
 * Run with an existing Playwright page on the app's Vite origin.
 * @param {import("playwright").Page} page
 * @returns {Promise<Array<{name: string, gutter: number}>>}
 */
export default async function smokeScrollArea(page) {
  await page.reload();
  await page.evaluate(async () => {
    const modules = performance.getEntriesByType("resource");
    const reactModule = modules.find((entry) => new URL(entry.name).pathname.endsWith("/react.js"));
    const reactDOMModule = modules.find((entry) => new URL(entry.name).pathname.endsWith("/react-dom_client.js"));
    if (reactModule === undefined || reactDOMModule === undefined) {
      throw new Error("Load the app's Vite page before running the scroll-area smoke test");
    }
    const React = (await import(reactModule.name)).default;
    const ReactDOM = (await import(reactDOMModule.name)).default;
    const { ScrollArea, ScrollBar } = await import("/src/components/ui/scroll-area.tsx");
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    ReactDOM.createRoot(host).render(
      React.createElement(
        "div",
        { className: "flex flex-wrap items-start gap-8 p-8" },
        ...[
          { name: "ltr", dir: "ltr", className: "h-48 w-80" },
          { name: "rtl", dir: "rtl", className: "h-48 w-80" },
          { name: "existing-padding", dir: "ltr", className: "h-48 w-80 pr-3" },
          { name: "both-axes", dir: "ltr", className: "h-48 w-80" },
        ].map(({ name, dir, className }) =>
          React.createElement(
            ScrollArea,
            { key: name, dir, className, type: "always", "data-testid": name },
            React.createElement(
              "div",
              { className: name === "both-axes" ? "h-96 w-[720px]" : "h-96 w-full" },
              React.createElement("button", { className: "w-full border" }, name),
            ),
            name === "both-axes"
              ? React.createElement(ScrollBar, { orientation: "horizontal" })
              : null,
          ),
        ),
      ),
    );
  });

  const results = [];
  for (const name of ["ltr", "rtl", "existing-padding", "both-axes"]) {
    const root = page.getByTestId(name);
    const viewport = root.locator('[data-slot="scroll-area-viewport"]');
    const scrollbar = root.locator('[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]');
    await scrollbar.waitFor({ state: "visible" });
    await page.waitForFunction((testId) => {
      const track = document.querySelector(`[data-testid="${testId}"] [data-slot="scroll-area-scrollbar"]`);
      return track !== null && track.getBoundingClientRect().width > 0;
    }, name);

    const viewportBox = await viewport.boundingBox();
    const scrollbarBox = await scrollbar.boundingBox();
    if (viewportBox === null || scrollbarBox === null) {
      throw new Error(`Missing scroll-area geometry: ${name}`);
    }
    const gutter = name === "rtl"
      ? viewportBox.x - (scrollbarBox.x + scrollbarBox.width)
      : scrollbarBox.x - (viewportBox.x + viewportBox.width);
    if (gutter < -0.5) {
      throw new Error(`Scrollbar overlaps viewport: ${JSON.stringify({ name, gutter, viewportBox, scrollbarBox })}`);
    }

    await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const verticalScroll = await viewport.evaluate((element) => element.scrollTop);
    if (verticalScroll <= 0) throw new Error(`Vertical scrolling failed: ${name}`);

    if (name === "both-axes") {
      await viewport.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
      const horizontalScroll = await viewport.evaluate((element) => element.scrollLeft);
      if (horizontalScroll <= 0) throw new Error("Horizontal scrolling failed: both-axes");
    }
    results.push({ name, gutter });
  }
  return results;
}
