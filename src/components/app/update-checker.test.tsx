// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalToast } from "sonner";
import { UpdateChecker } from "@/components/app/update-checker";

type ToastCall = (message: React.ReactNode, options?: ExternalToast) => string;

const mocks = vi.hoisted(() => ({
  check: vi.fn(async () => ({
    currentVersion: "0.18.3",
    version: "0.19.0",
    body: "",
    downloadAndInstall: vi.fn(async () => {}),
  })),
  listen: vi.fn(async () => () => {}),
  toast: vi.fn<ToastCall>(() => "app-update"),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

describe("UpdateChecker toast", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("uses an arrow icon and keeps the update action compact", async () => {
    vi.stubEnv("DEV", false);
    render(<UpdateChecker />);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());

    const options = mocks.toast.mock.calls[0][1];
    if (options === undefined) throw new Error("Update toast options were not provided");

    const description = options.description;
    if (!React.isValidElement(description)) throw new Error("Update version description must be JSX");
    const descriptionMarkup = renderToStaticMarkup(description);
    expect(descriptionMarkup).toContain("tabler-icon-arrow-right");
    expect(descriptionMarkup).not.toContain("->");

    const action = options.action;
    if (!React.isValidElement(action)) throw new Error("Update toast actions must be JSX");
    const actionMarkup = renderToStaticMarkup(action);
    expect(actionMarkup).toContain("gap-1");
    expect(actionMarkup).toMatch(/<button[^>]*class="[^"]*px-1[^"]*"[^>]*>Update<\/button>/);
  });
});
