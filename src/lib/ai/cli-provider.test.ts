import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateText, streamText, Output } from "ai";
import { z } from "zod";

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

  it("leaves a single user turn bare (structured-op shape)", () => {
    const { text } = flattenCliPrompt([
      { role: "user", content: [{ type: "text", text: "only" }] },
    ]);
    expect(text).toBe("only");
  });

  it("labels both sides in a multi-turn exchange", () => {
    const { text } = flattenCliPrompt([
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
    ]);
    expect(text).toBe("User: first\n\nAssistant: reply\n\nUser: second");
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

  it("emits a well-formed lifecycle with consistent part ids", async () => {
    cliGenerate.mockResolvedValue({ text: "body", model: null });
    const model = createCliModel("codex");
    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "go" }] }],
    } as never);

    const parts: { type: string; id?: string }[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value as { type: string; id?: string });
    }
    expect(parts.map((p) => p.type)).toEqual([
      "stream-start",
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ]);
    const ided = parts.filter((p) => p.id !== undefined);
    expect(ided.every((p) => p.id === "0")).toBe(true);
  });
});

// The adapter exists to make the CLI work uniformly through the real AI SDK.
// These drive generateText/Output.object and streamText end-to-end (with only
// the Rust cliGenerate boundary mocked) so a shape/contract regression fails
// here, not silently in production.
describe("createCliModel through the AI SDK", () => {
  it("generateText + Output.object parses the CLI JSON into a validated object", async () => {
    cliGenerate.mockResolvedValue({ text: '{"title":"Scene one"}', model: "gpt-5-codex" });
    const model = createCliModel("codex");
    const { output } = await generateText({
      model,
      output: Output.object({ schema: z.object({ title: z.string() }) }),
      prompt: "go",
    });
    expect(output).toEqual({ title: "Scene one" });
  });

  it("streamText drains the buffered body through textStream", async () => {
    cliGenerate.mockResolvedValue({ text: "streamed body", model: null });
    const model = createCliModel("claude");
    const result = streamText({ model, prompt: "go" });
    let acc = "";
    for await (const delta of result.textStream) acc += delta;
    expect(acc).toBe("streamed body");
  });
});
