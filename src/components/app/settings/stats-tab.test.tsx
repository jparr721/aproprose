// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

// The chart pulls in radix Tooltip/ScrollArea; stub it so this test targets the
// attainment math and copy, not the calendar rendering.
vi.mock("@/components/app/stats/contribution-chart", () => ({
  ContributionChart: () => null,
}));

import { StatsTab } from "@/components/app/settings/stats-tab";
import { useSettingsStore } from "@/stores/settings-store";
import { useStatsStore } from "@/stores/stats-store";
import { localDateKey } from "@/lib/stats/stats";

const todayKey = localDateKey(new Date());

beforeEach(() => {
  useSettingsStore.setState({ dailyWordGoal: null });
  useStatsStore.setState({ days: {}, baselines: {} });
});
afterEach(cleanup);

describe("StatsTab daily goal", () => {
  it("prompts to set a goal when none exists", () => {
    render(<StatsTab />);
    expect(screen.getByText("Set a goal to track how often you hit it.")).toBeTruthy();
  });

  it("prompts to start writing when a goal is set but nothing is written", () => {
    useSettingsStore.setState({ dailyWordGoal: 500 });
    render(<StatsTab />);
    expect(screen.getByText("Start writing to track your goal.")).toBeTruthy();
    expect(screen.getByText("Remove goal")).toBeTruthy();
  });

  it("reports attainment across writing days with pluralization and shortfall", () => {
    useSettingsStore.setState({ dailyWordGoal: 500 });
    useStatsStore.setState({
      days: {
        "2026-06-20": { added: 600, removed: 0, saves: 1 }, // hit
        "2026-06-21": { added: 550, removed: 0, saves: 2 }, // hit
        "2026-06-22": { added: 300, removed: 0, saves: 1 }, // miss
      },
      baselines: {},
    });
    render(<StatsTab />);
    expect(screen.getByText("67%")).toBeTruthy();
    expect(screen.getByText(/Hit your goal on 2 of 3 writing days\./)).toBeTruthy();
    expect(screen.getByText(/1 fell short\./)).toBeTruthy();
  });

  it("uses the singular 'writing day' and omits shortfall when every day hit", () => {
    useSettingsStore.setState({ dailyWordGoal: 500 });
    useStatsStore.setState({
      days: { [todayKey]: { added: 700, removed: 0, saves: 1 } },
      baselines: {},
    });
    render(<StatsTab />);
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByText(/Hit your goal on 1 of 1 writing day\./)).toBeTruthy();
    expect(screen.queryByText(/fell short/)).toBeNull();
  });
});
