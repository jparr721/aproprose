// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupScheduleFields } from "@/components/app/backup-schedule-fields";

afterEach(cleanup);

describe("Backup schedule fields", () => {
  it("exposes named controls and forwards auto-sync changes", () => {
    const onAutoSyncChange = vi.fn();
    render(<BackupScheduleFields autoSync={true} intervalMinutes={10} available={true} onAutoSyncChange={onAutoSyncChange} onIntervalChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch", { name: "Auto-sync this project" }));
    expect(onAutoSyncChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.getByRole("slider", { name: "Backup interval" })).toBeTruthy();
  });

  it("disables both controls when backup is unavailable", () => {
    render(<BackupScheduleFields autoSync={true} intervalMinutes={10} available={false} onAutoSyncChange={vi.fn()} onIntervalChange={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Auto-sync this project" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("slider", { name: "Backup interval" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("gives simultaneously mounted schedules distinct label targets", () => {
    const props = { autoSync: true, intervalMinutes: 10, available: true, onAutoSyncChange: vi.fn(), onIntervalChange: vi.fn() };
    render(<><BackupScheduleFields {...props} /><BackupScheduleFields {...props} /></>);
    const switches = screen.getAllByRole("switch", { name: "Auto-sync this project" });
    expect(switches[0].id).not.toBe(switches[1].id);
    expect(switches[0].id).not.toBe("");
  });
});
