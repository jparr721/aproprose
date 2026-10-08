// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotificationsTab } from "@/components/app/settings/notifications-tab";
import { useNotificationStore } from "@/stores/notification-store";
import { useSettingsDialogStore } from "@/stores/settings-dialog-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useProjectStore } from "@/stores/project-store";

beforeEach(() => {
  useNotificationStore.setState({ notifications: [] });
  useSettingsDialogStore.setState({
    open: false,
    tab: "notifications",
    aiTarget: null,
  });
  useSettingsStore.setState({ aiProvider: "openai", aiModel: "gpt-test" });
  useProjectStore.setState({ project: null });
});
afterEach(cleanup);

const recordKeyError = (): void =>
  useNotificationStore
    .getState()
    .record({
      type: "ai-key-rejected",
      source: "Story refresh",
      projectRoot: "/book",
      provider: "openrouter",
    });

describe("Notifications settings", () => {
  it("has an empty state before any app errors", () => {
    render(<NotificationsTab />);
    expect(screen.getByText("Nothing needs attention")).toBeTruthy();
  });

  it("opens grouped details with repair steps and the correct provider settings", () => {
    recordKeyError();
    recordKeyError();
    render(<NotificationsTab />);
    expect(screen.getByText("2 times")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /AI key rejected/ }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/Replace this provider's key/),
    ).toBeTruthy();
    expect(within(dialog).getByText("/book")).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Open AI settings" }),
    );
    expect(useSettingsStore.getState().aiProvider).toBe("openrouter");
    expect(useSettingsDialogStore.getState()).toMatchObject({
      open: true,
      tab: "ai",
      aiTarget: "key",
    });
  });

  it("moves a resolved issue to history and brings it back on recurrence", () => {
    recordKeyError();
    render(<NotificationsTab />);
    fireEvent.click(screen.getByRole("button", { name: /AI key rejected/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));
    expect(screen.getByText("Nothing needs attention")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resolved" }));
    expect(
      screen.getByRole("button", { name: /AI key rejected/ }),
    ).toBeTruthy();
  });

  it("disables actions that would show another project's build log", () => {
    useNotificationStore
      .getState()
      .record({
        type: "build",
        source: "PDF build",
        projectRoot: "/other",
        provider: null,
      });
    render(<NotificationsTab />);
    fireEvent.click(screen.getByRole("button", { name: /PDF build failed/ }));
    expect(
      screen
        .getByRole("button", { name: "View build log" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByText("Open this project before retrying its action."),
    ).toBeTruthy();
  });
});
