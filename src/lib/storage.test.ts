import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { invoke, isTauri } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { nativeStateStorage, tauriStateStorage, useStorageIssueStore } from "@/lib/storage";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";
import { useStatsStore } from "@/stores/stats-store";

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(null);
  vi.mocked(isTauri).mockReturnValue(true);
  useStorageIssueStore.setState({ issues: {} });
});

describe("native state persistence", () => {
  it.each(["getItem", "setItem", "removeItem"] as const)("rejects native %s failures", async (operation) => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("permission denied"));
    const result = operation === "setItem" ? nativeStateStorage.setItem("settings", "{}") : nativeStateStorage[operation]("settings");
    await expect(result).rejects.toThrow("permission denied");
  });

  it("keeps browser preview explicitly transient", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(tauriStateStorage.getItem("settings")).resolves.toBeNull();
    await tauriStateStorage.setItem("settings", "{}");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports failures from real Zustand setters without rejected fire-and-forget promises", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("disk full"));
    useSettingsStore.getState().setTheme("dark");
    useViewStore.getState().setRightPanelWidth(420);
    useStatsStore.getState().recordSave("/book", 10);
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(useStorageIssueStore.getState().issues.settings).toContain("disk full");
    expect(useStorageIssueStore.getState().issues.view).toContain("disk full");
    expect(useStorageIssueStore.getState().issues["writing-stats"]).toContain("disk full");
    expect(toast.error).toHaveBeenCalled();
  });
});
