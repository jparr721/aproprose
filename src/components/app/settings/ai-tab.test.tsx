// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAiKeyStatus: vi.fn(),
  setAiKey: vi.fn(),
  listTextModels: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getAiKeyStatus: mocks.getAiKeyStatus,
  setAiKey: mocks.setAiKey,
}));

vi.mock("@/lib/ai/models", () => ({
  listTextModels: mocks.listTextModels,
  resetModelMetadata: vi.fn(),
}));

vi.mock("@/lib/ai/model", () => ({
  resetAiProvider: vi.fn(),
}));

import { AiTab } from "@/components/app/settings/ai-tab";
import { useSettingsDialogStore } from "@/stores/settings-dialog-store";
import { useSettingsStore } from "@/stores/settings-store";

afterEach(cleanup);

beforeEach(() => {
  mocks.getAiKeyStatus.mockReset().mockResolvedValue({ status: "missing" });
  mocks.setAiKey.mockReset().mockResolvedValue({ status: "saved" });
  mocks.listTextModels.mockReset().mockResolvedValue([]);
  useSettingsStore.setState({
    aiProvider: "openai",
    aiModel: null,
    styleGuide: "",
    editingRules: "",
  });
  useSettingsDialogStore.setState({ aiTarget: null });
});

describe("AiTab", () => {
  it("shows OpenAI as the default selectable provider", async () => {
    render(<AiTab />);

    await waitFor(() =>
      expect(mocks.getAiKeyStatus).toHaveBeenCalledExactlyOnceWith("openai"),
    );
    expect(screen.getByText("OpenAI key")).toBeTruthy();
    expect(screen.getByText("AI model")).toBeTruthy();
    expect(screen.getByText("AI provider")).toBeTruthy();
  });

  it("loads OpenRouter key state and models when OpenRouter is active", async () => {
    useSettingsStore.setState({
      aiProvider: "openrouter",
      aiModel: "anthropic/claude-sonnet-4",
    });
    mocks.getAiKeyStatus.mockResolvedValue({ status: "configured" });
    mocks.listTextModels.mockResolvedValue(["anthropic/claude-sonnet-4"]);

    render(<AiTab />);

    await waitFor(() =>
      expect(mocks.getAiKeyStatus).toHaveBeenCalledExactlyOnceWith("openrouter"),
    );
    await waitFor(() =>
      expect(mocks.listTextModels).toHaveBeenCalledExactlyOnceWith("openrouter"),
    );
    expect(screen.getByText("OpenRouter key")).toBeTruthy();
    expect(screen.getByText("anthropic/claude-sonnet-4")).toBeTruthy();
  });

  it("saves an OpenRouter key for the active provider", async () => {
    useSettingsStore.setState({ aiProvider: "openrouter" });
    render(<AiTab />);
    await waitFor(() =>
      expect(mocks.getAiKeyStatus).toHaveBeenCalledExactlyOnceWith("openrouter"),
    );

    fireEvent.change(screen.getByPlaceholderText("sk-or-v1-"), {
      target: { value: "sk-or-v1-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.setAiKey).toHaveBeenCalledExactlyOnceWith(
        "openrouter",
        "sk-or-v1-test",
      ),
    );
  });

  it("describes standing instructions for both modes", async () => {
    render(<AiTab />);

    await waitFor(() => expect(mocks.getAiKeyStatus).toHaveBeenCalledOnce());
    expect(screen.getByText("Writing and editing instructions")).toBeTruthy();
    expect(screen.getByText("Applies to Writing and Edit.")).toBeTruthy();
  });

  it("shows a safe key-status failure and retries without rendering bridge details", async () => {
    mocks.getAiKeyStatus.mockRejectedValue(
      new Error("provider response body at /Users/author/.config/aproprose"),
    );

    render(<AiTab />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "AI settings are unavailable. Retry.",
    );
    expect(document.body.textContent).not.toContain("/Users/author/.config");
    expect(document.body.textContent).not.toContain("provider response body");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(mocks.getAiKeyStatus).toHaveBeenCalledTimes(2),
    );
  });

  it("focuses the model selector after opening AI settings for model recovery", async () => {
    mocks.getAiKeyStatus.mockResolvedValue({ status: "configured" });
    mocks.listTextModels.mockResolvedValue(["gpt-5-mini"]);
    useSettingsDialogStore.getState().openAiSettings("model");

    render(<AiTab />);

    await waitFor(() => {
      const selectors = screen.getAllByRole("combobox");
      expect(document.activeElement).toBe(selectors[selectors.length - 1]);
    });
    expect(useSettingsDialogStore.getState().aiTarget).toBeNull();
  });
});
