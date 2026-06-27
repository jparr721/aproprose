import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsDialogStore, SETTINGS_TABS } from "@/stores/settings-dialog-store";

beforeEach(() =>
  useSettingsDialogStore.setState({ open: false, tab: SETTINGS_TABS.APPEARANCE }),
);

describe("settings-dialog-store", () => {
  it("starts closed on the appearance tab", () => {
    const s = useSettingsDialogStore.getState();
    expect(s.open).toBe(false);
    expect(s.tab).toBe(SETTINGS_TABS.APPEARANCE);
  });

  it("setOpen toggles open without changing the tab", () => {
    useSettingsDialogStore.getState().setTab(SETTINGS_TABS.AI);
    useSettingsDialogStore.getState().setOpen(true);
    expect(useSettingsDialogStore.getState().open).toBe(true);
    expect(useSettingsDialogStore.getState().tab).toBe(SETTINGS_TABS.AI);
  });

  it("openWithTab opens on the requested tab", () => {
    useSettingsDialogStore.getState().openWithTab(SETTINGS_TABS.STATS);
    const s = useSettingsDialogStore.getState();
    expect(s.open).toBe(true);
    expect(s.tab).toBe(SETTINGS_TABS.STATS);
  });

  it("setTab changes the tab without opening or closing", () => {
    useSettingsDialogStore.setState({ open: true, tab: SETTINGS_TABS.APPEARANCE });
    useSettingsDialogStore.getState().setTab(SETTINGS_TABS.KEYBOARD);
    expect(useSettingsDialogStore.getState().open).toBe(true);
    expect(useSettingsDialogStore.getState().tab).toBe(SETTINGS_TABS.KEYBOARD);
  });
});
