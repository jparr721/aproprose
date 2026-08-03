// model.ts - resolves the selected model through its configured provider.
//
// The API key is read from Rust at runtime, HTTP egress uses the Tauri HTTP
// plugin to avoid webview CORS. Callers provide the frozen provider and model id.

import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import {
  createOpenRouter,
  type OpenRouterProvider,
} from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAiConfig } from "@/lib/tauri";
import type { AiProvider } from "@/lib/types";

let openAiProviderPromise: Promise<OpenAIProvider> | null = null;
let openRouterProviderPromise: Promise<OpenRouterProvider> | null = null;

function getOpenAiProvider(): Promise<OpenAIProvider> {
  if (openAiProviderPromise === null) {
    openAiProviderPromise = (async () => {
      const { apiKey } = await getAiConfig("openai");
      return createOpenAI({
        apiKey,
        fetch: tauriFetch as unknown as typeof globalThis.fetch,
      });
    })().catch((error: unknown) => {
      openAiProviderPromise = null;
      throw error;
    });
  }
  return openAiProviderPromise;
}

function getOpenRouterProvider(): Promise<OpenRouterProvider> {
  if (openRouterProviderPromise === null) {
    openRouterProviderPromise = (async () => {
      const { apiKey } = await getAiConfig("openrouter");
      return createOpenRouter({
        apiKey,
        compatibility: "strict",
        fetch: tauriFetch as unknown as typeof globalThis.fetch,
      });
    })().catch((error: unknown) => {
      openRouterProviderPromise = null;
      throw error;
    });
  }
  return openRouterProviderPromise;
}

export function resetAiProvider(): void {
  openAiProviderPromise = null;
  openRouterProviderPromise = null;
}

const modelFactories: Record<
  AiProvider,
  (modelId: string) => Promise<LanguageModel>
> = {
  openai: async (modelId) => (await getOpenAiProvider())(modelId),
  openrouter: async (modelId) => (await getOpenRouterProvider())(modelId),
};

export function getModel(
  provider: AiProvider,
  modelId: string,
): Promise<LanguageModel> {
  return modelFactories[provider](modelId);
}
