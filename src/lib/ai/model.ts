// model.ts - resolves the selected OpenAI model.
//
// The API key is read from Rust at runtime, HTTP egress uses the Tauri HTTP
// plugin to avoid webview CORS. Callers provide the frozen model id.

import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAiConfig } from "@/lib/tauri";

let providerPromise: Promise<OpenAIProvider> | null = null;

function getProvider(): Promise<OpenAIProvider> {
  if (providerPromise === null) {
    providerPromise = (async () => {
      const { apiKey } = await getAiConfig();
      return createOpenAI({
        apiKey,
        fetch: tauriFetch as unknown as typeof globalThis.fetch,
      });
    })().catch((error: unknown) => {
      providerPromise = null;
      throw error;
    });
  }
  return providerPromise;
}

export function resetAiProvider(): void {
  providerPromise = null;
}

export async function getModel(modelId: string): Promise<LanguageModel> {
  const provider = await getProvider();
  return provider(modelId);
}
