// cli-provider.ts - a Vercel AI SDK LanguageModelV3 backed by a local CLI
// (codex/claude) run on the Rust side. Keeps generateText/Output.object/streamText
// working uniformly: the SDK only ever sees a standard model object. Streaming is
// buffered (single chunk) - the CLI generate command resolves all at once.

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3TextPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { cliGenerate, type CliKind } from "@/lib/tauri";

const EMPTY_USAGE: LanguageModelV3Usage = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

/** Flatten the SDK prompt into a single system string + user-facing text. */
export function flattenCliPrompt(prompt: LanguageModelV3CallOptions["prompt"]): {
  system: string | null;
  text: string;
} {
  const systemParts: string[] = [];
  const turns: string[] = [];
  for (const msg of prompt) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else if (msg.role === "user") {
      const text = msg.content
        .filter((p): p is LanguageModelV3TextPart => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (text) turns.push(text);
    } else if (msg.role === "assistant") {
      const text = msg.content
        .filter((p): p is LanguageModelV3TextPart => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (text) turns.push(`Assistant: ${text}`);
    }
  }
  return {
    system: systemParts.length ? systemParts.join("\n\n") : null,
    text: turns.join("\n\n"),
  };
}

export function createCliModel(kind: CliKind): LanguageModelV3 {
  const doGenerate: LanguageModelV3["doGenerate"] = async (
    options: LanguageModelV3CallOptions,
  ) => {
    const { system, text } = flattenCliPrompt(options.prompt);
    const schema =
      options.responseFormat?.type === "json"
        ? (options.responseFormat.schema ?? null)
        : null;
    const { text: out } = await cliGenerate({ kind, system, prompt: text, schema });
    return {
      content: [{ type: "text" as const, text: out }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: EMPTY_USAGE,
      warnings: [],
    };
  };

  return {
    specificationVersion: "v3",
    provider: kind,
    modelId: `${kind}-cli`,
    supportedUrls: {},
    doGenerate,
    async doStream(options) {
      const result = await doGenerate(options);
      const full = result.content
        .filter((c): c is LanguageModelV3TextPart => c.type === "text")
        .map((c) => c.text)
        .join("");
      const chunks: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "0" },
        { type: "text-delta", id: "0", delta: full },
        { type: "text-end", id: "0" },
        { type: "finish", usage: EMPTY_USAGE, finishReason: { unified: "stop", raw: "stop" } },
      ];
      return {
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks,
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
        }),
      };
    },
  };
}
