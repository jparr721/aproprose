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
  hasAiKey: vi.fn(),
  setAiKey: vi.fn(),
  listTextModels: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  hasAiKey: mocks.hasAiKey,
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
import { useSettingsStore } from "@/stores/settings-store";

afterEach(cleanup);

beforeEach(() => {
  mocks.hasAiKey.mockReset().mockResolvedValue(false);
  mocks.setAiKey.mockReset().mockResolvedValue(undefined);
  mocks.listTextModels.mockReset().mockResolvedValue([]);
  useSettingsStore.setState({
    aiProvider: "openai",
    aiModel: null,
    styleGuide: "",
    editingRules: "",
  });
});

describe("AiTab", () => {
  it("shows OpenAI as the default selectable provider", async () => {
    render(<AiTab />);

    await waitFor(() =>
      expect(mocks.hasAiKey).toHaveBeenCalledExactlyOnceWith("openai"),
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
    mocks.hasAiKey.mockResolvedValue(true);
    mocks.listTextModels.mockResolvedValue(["anthropic/claude-sonnet-4"]);

    render(<AiTab />);

    await waitFor(() =>
      expect(mocks.hasAiKey).toHaveBeenCalledExactlyOnceWith("openrouter"),
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
      expect(mocks.hasAiKey).toHaveBeenCalledExactlyOnceWith("openrouter"),
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

    await waitFor(() => expect(mocks.hasAiKey).toHaveBeenCalledOnce());
    expect(screen.getByText("Writing and editing instructions")).toBeTruthy();
    expect(screen.getByText("Applies to Writing and Edit.")).toBeTruthy();
  });
});
