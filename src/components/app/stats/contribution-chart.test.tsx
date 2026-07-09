// @vitest-environment happy-dom
import { cleanup, render, screen, type RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ContributionChart } from "@/components/app/stats/contribution-chart";
import { TooltipProvider } from "@/components/ui/tooltip";
import { localDateKey } from "@/lib/stats/stats";
import type { WritingStats } from "@/lib/stats/schema";

const todayKey = localDateKey(new Date());

afterEach(cleanup);

describe("ContributionChart", () => {
  function renderChart(days: WritingStats["days"], goal: number | null): RenderResult {
    return render(
      <TooltipProvider>
        <ContributionChart days={days} goal={goal} />
      </TooltipProvider>,
    );
  }

  it("renders goal hits as a separate chart instead of an activity cell outline", () => {
    const days: WritingStats["days"] = {
      [todayKey]: { added: 650, removed: 0, saves: 1 },
    };

    const { container } = renderChart(days, 500);

    expect(screen.getByText("Goal hits")).toBeTruthy();
    expect(screen.getByLabelText("Goal hits chart")).toBeTruthy();
    expect(container.querySelector("[class*='ring-accent-ink']")).toBeNull();
  });

  it("keeps the goal hits chart out of the no-goal state", () => {
    const days: WritingStats["days"] = {
      [todayKey]: { added: 650, removed: 0, saves: 1 },
    };

    renderChart(days, null);

    expect(screen.queryByText("Goal hits")).toBeNull();
    expect(screen.queryByLabelText("Goal hits chart")).toBeNull();
  });
});
