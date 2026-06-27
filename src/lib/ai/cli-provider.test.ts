import { describe, it, expect, vi, beforeEach } from "vitest";

const { cliGenerate } = vi.hoisted(() => ({ cliGenerate: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ cliGenerate }));

import { createCliModel, flattenCliPrompt } from "@/lib/ai/cli-provider";

beforeEach(() => cliGenerate.mockReset());

describe("flattenCliPrompt", () => {
  it("splits system messages from user/assistant text", () => {
    const { system, text } = flattenCliPrompt([
      { role: "system", content: "You write prose." },
      { role: "user", content: [{ type: "text", text: "Continue the scene." }] },
    ]);
    expect(system).toBe("You write prose.");
    expect(text).toBe("Continue the scene.");
  });

  it("returns null system when there is none", () => {
    const { system } = flattenCliPrompt([
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ]);
    expect(system).toBeNull();
  });

  it("prefixes assistant turns and leaves user turns bare", () => {
    const { text } = flattenCliPrompt([
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
    ]);
    expect(text).toBe("first\n\nAssistant: reply\n\nsecond");
  });
});

describe("createCliModel.doGenerate", () => {
  it("forwards the responseFormat schema and returns text content", async () => {
    cliGenerate.mockResolvedValue({ text: '{"ok":true}', model: "gpt-5-codex" });
    const model = createCliModel("codex");
    const res = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      responseFormat: { type: "json", schema: { type: "object" } },
    } as never);

    expect(cliGenerate).toHaveBeenCalledWith({
      kind: "codex",
      system: null,
      prompt: "go",
      schema: { type: "object" },
    });
    expect(res.content).toEqual([{ type: "text", text: '{"ok":true}' }]);
    expect(res.finishReason.unified).toBe("stop");
    expect(res.finishReason.raw).toBe("stop");
  });

  it("passes null schema for free-text", async () => {
    cliGenerate.mockResolvedValue({ text: "tidy text", model: null });
    const model = createCliModel("claude");
    await model.doGenerate({
      prompt: [
        { role: "system", content: "Clean it." },
        { role: "user", content: [{ type: "text", text: "raw" }] },
      ],
    } as never);
    expect(cliGenerate).toHaveBeenCalledWith({
      kind: "claude",
      system: "Clean it.",
      prompt: "raw",
      schema: null,
    });
  });
});

describe("createCliModel.doStream", () => {
  it("emits the buffered text as a single delta", async () => {
    cliGenerate.mockResolvedValue({ text: "streamed body", model: null });
    const model = createCliModel("codex");
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "go" }] }],
    } as never);

    const parts: unknown[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    const deltas = parts.filter(
      (p): p is { type: "text-delta"; delta: string } =>
        typeof p === "object" && p !== null && (p as { type?: string }).type === "text-delta",
    );
    expect(deltas.map((d) => d.delta).join("")).toBe("streamed body");
    expect(parts.some((p) => (p as { type?: string }).type === "finish")).toBe(true);
  });
});
