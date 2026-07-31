// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasOpenAiKey: vi.fn(),
  setOpenAiKey: vi.fn(),
  listTextModels: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  hasOpenAiKey: mocks.hasOpenAiKey,
  setOpenAiKey: mocks.setOpenAiKey,
}));

vi.mock("@/lib/ai/models", () => ({
  listTextModels: mocks.listTextModels,
}));

vi.mock("@/lib/ai/model", () => ({
  resetAiProvider: vi.fn(),
}));

import { AiTab } from "@/components/app/settings/ai-tab";
import { useSettingsStore } from "@/stores/settings-store";

afterEach(cleanup);

beforeEach(() => {
  mocks.hasOpenAiKey.mockReset().mockResolvedValue(false);
  mocks.setOpenAiKey.mockReset().mockResolvedValue(undefined);
  mocks.listTextModels.mockReset().mockResolvedValue([]);
  useSettingsStore.setState({
    aiModel: null,
    styleGuide: "",
    editingRules: "",
  });
});

describe("AiTab", () => {
  it("shows OpenAI configuration without provider or CLI controls", async () => {
    render(<AiTab />);

    await waitFor(() => expect(mocks.hasOpenAiKey).toHaveBeenCalledOnce());
    expect(screen.getByText("OpenAI key")).toBeTruthy();
    expect(screen.getByText("AI model")).toBeTruthy();
    expect(screen.queryByText("AI provider")).toBeNull();
    expect(screen.queryByText(/Codex CLI/)).toBeNull();
    expect(screen.queryByText(/Claude Code/)).toBeNull();
  });

  it("describes standing instructions for both modes without Muse copy", async () => {
    render(<AiTab />);

    await waitFor(() => expect(mocks.hasOpenAiKey).toHaveBeenCalledOnce());
    expect(screen.getByText("Writing and editing instructions")).toBeTruthy();
    expect(screen.getByText("Applies to Writing and Edit.")).toBeTruthy();
    expect(screen.queryByText(/Muse/)).toBeNull();
  });
});
