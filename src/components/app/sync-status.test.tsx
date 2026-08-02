// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncStatus } from "@/components/app/sync-status";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SyncStatus as SyncState } from "@/lib/types";
import { useSyncStore } from "@/stores/sync-store";

const onReview = vi.fn();
const onSetup = vi.fn();

function renderStatus(): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <SyncStatus onReview={onReview} onSetup={onSetup} />
    </TooltipProvider>,
  );
}

function setBackupState(status: SyncState): void {
  useSyncStore.setState({
    status,
    isRepo: true,
    remoteUrl: "https://github.com/author/quiet-novel.git",
    lastError: null,
    lastSyncedAt: null,
    changedFiles: [],
  });
}

function expectIcon(button: HTMLElement, icon: string): void {
  const svg = button.querySelector("svg");
  if (svg === null) throw new Error("Expected an icon");
  expect(svg.getAttribute("class")).toContain(`lucide-${icon}`);
}

afterEach(cleanup);

beforeEach(() => {
  onReview.mockReset();
  onSetup.mockReset();
  setBackupState("synced");
});

describe("SyncStatus", () => {
  it.each([
    ["synced", "Backed up", "cloud-check"],
    ["dirty", "Unsynced changes", "cloud-upload"],
    ["offline", "Offline", "cloud-off"],
    ["error", "Sync error", "cloud-alert"],
  ] as const)("renders %s as an icon-only %s trigger", (status, label, icon) => {
    setBackupState(status);
    renderStatus();

    const trigger = screen.getByRole("button", { name: label });
    expect(trigger.textContent).toBe("");
    expectIcon(trigger, icon);
    expect(trigger.querySelector("svg")?.getAttribute("class")).toContain("size-3.5");
  });

  it("uses the Spinner for an in-progress backup", () => {
    setBackupState("syncing");
    renderStatus();

    const trigger = screen.getByRole("button", { name: "Syncing" });
    expect(trigger.textContent).toBe("");
    const spinner = trigger.querySelector('[data-slot="spinner"]');
    expect(spinner).not.toBeNull();
    expect(spinner?.getAttribute("class")).toContain("size-3.5");
  });

  it("keeps backup details and actions in the icon trigger popover", async () => {
    renderStatus();

    fireEvent.click(screen.getByRole("button", { name: "Backed up" }));

    expect(await screen.findByRole("button", { name: "Sync now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review changes" })).toBeTruthy();
  });

  it("keeps the setup action icon-only", () => {
    useSyncStore.setState({
      status: "needsSetup",
      isRepo: false,
      remoteUrl: null,
      lastError: null,
      lastSyncedAt: null,
      changedFiles: [],
    });
    renderStatus();

    const trigger = screen.getByRole("button", { name: "Back up to GitHub" });
    expect(trigger.getAttribute("data-size")).toBe("icon-sm");
    expect(trigger.textContent).toBe("");
    expectIcon(trigger, "cloud-upload");
    expect(trigger.querySelector("svg")?.getAttribute("class")).toContain("size-3.5");

    fireEvent.click(trigger);
    expect(onSetup).toHaveBeenCalledTimes(1);
  });
});
