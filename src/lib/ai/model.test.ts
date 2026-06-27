import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/cli-provider", () => ({
  createCliModel: vi.fn((kind: string) => ({ provider: kind, modelId: `${kind}-cli` })),
}));
vi.mock("@/lib/tauri", () => ({ getAiConfig: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { getModel } from "@/lib/ai/model";
import { useSettingsStore } from "@/stores/settings-store";
import { createCliModel } from "@/lib/ai/cli-provider";

const mockCreateCliModel = createCliModel as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCreateCliModel.mockClear();
  useSettingsStore.setState({ aiProvider: "openai", aiModel: null });
});

describe("getModel provider routing", () => {
  it("returns the codex CLI model when aiProvider is codex", async () => {
    useSettingsStore.setState({ aiProvider: "codex" });
    const model = await getModel();
    expect(mockCreateCliModel).toHaveBeenCalledWith("codex");
    expect((model as { provider: string }).provider).toBe("codex");
  });

  it("returns the claude CLI model when aiProvider is claude", async () => {
    useSettingsStore.setState({ aiProvider: "claude" });
    const model = await getModel();
    expect(mockCreateCliModel).toHaveBeenCalledWith("claude");
    expect((model as { provider: string }).provider).toBe("claude");
  });

  it("throws on openai without a selected model", async () => {
    useSettingsStore.setState({ aiProvider: "openai", aiModel: null });
    await expect(getModel()).rejects.toThrow(/Select an AI model/);
    expect(mockCreateCliModel).not.toHaveBeenCalled();
  });
});
