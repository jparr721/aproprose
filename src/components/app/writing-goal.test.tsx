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

import { WritingGoal } from "@/components/app/writing-goal";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useSettingsStore } from "@/stores/settings-store";
import { useStatsStore } from "@/stores/stats-store";
import { localDateKey } from "@/lib/stats/stats";

const todayKey = localDateKey(new Date());

// WritingGoal's onboarding row is a SidebarMenuButton, which reads sidebar
// context - render it inside the provider it always ships within.
const renderGoal = () =>
  render(
    <SidebarProvider>
      <WritingGoal />
    </SidebarProvider>,
  );

beforeEach(() => {
  useSettingsStore.setState({ dailyWordGoal: null });
  useStatsStore.setState({ days: {}, baselines: {} });
});
afterEach(cleanup);

describe("WritingGoal", () => {
  it("shows the onboarding affordance when no goal is set", () => {
    renderGoal();
    expect(screen.getByText("Set a writing goal")).toBeTruthy();
  });

  it("shows today's words against the goal once set", () => {
    useSettingsStore.setState({ dailyWordGoal: 500 });
    useStatsStore.setState({
      days: { [todayKey]: { added: 320, removed: 0, saves: 1 } },
      baselines: {},
    });
    renderGoal();
    const trigger = screen.getByRole("button", { name: "Edit daily writing goal" });
    expect(trigger.textContent).toContain("Daily goal");
    expect(trigger.textContent).toContain("320 / 500");
  });

  it("flips to a reached state when today meets the goal", () => {
    useSettingsStore.setState({ dailyWordGoal: 500 });
    useStatsStore.setState({
      days: { [todayKey]: { added: 540, removed: 0, saves: 2 } },
      baselines: {},
    });
    renderGoal();
    expect(screen.getByText("Goal reached")).toBeTruthy();
  });
});
