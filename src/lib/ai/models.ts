// models.ts - lists agent-capable models and resolves their context windows.

import { uniq } from "es-toolkit";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  fetchModels,
  type FetchLike,
  type ProviderInfo,
} from "tokenlens";
import { modelContextWindow } from "@/lib/ai/agent-compaction";
import { withAiRetry } from "@/lib/ai/errors";
import { getAiConfig } from "@/lib/tauri";
import type { AiProvider } from "@/lib/types";

const OPENAI_MODELS_ENDPOINT = "https://api.openai.com/v1/models";
const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";

let currentOpenAiModelsPromise: Promise<ProviderInfo> | null = null;
let currentOpenRouterModelsPromise: Promise<OpenRouterModelInfo[]> | null = null;

function currentOpenAiModels(): Promise<ProviderInfo> {
  if (currentOpenAiModelsPromise === null) {
    currentOpenAiModelsPromise = withAiRetry(async () => {
      const provider = await fetchModels({
        provider: "openai",
        fetch: tauriFetch as unknown as FetchLike,
      });
      if (provider === undefined) {
        throw new Error("models.dev returned no OpenAI model metadata.");
      }
      return provider;
    }).catch((error: unknown) => {
      currentOpenAiModelsPromise = null;
      throw error;
    });
  }
  return currentOpenAiModelsPromise;
}

async function fetchModelResponse<T>(
  endpoint: string,
  apiKey: string,
): Promise<T> {
  return withAiRetry(async () => {
    const response = await tauriFetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Model request failed for ${endpoint}: HTTP ${response.status} - ${body}`,
      );
    }
    return (await response.json()) as T;
  });
}

function currentOpenRouterModels(apiKey: string): Promise<OpenRouterModelInfo[]> {
  if (currentOpenRouterModelsPromise === null) {
    currentOpenRouterModelsPromise = fetchModelResponse<OpenRouterModelsResponse>(
      OPENROUTER_MODELS_ENDPOINT,
      apiKey,
    )
      .then((response) => response.data)
      .catch((error: unknown) => {
        currentOpenRouterModelsPromise = null;
        throw error;
      });
  }
  return currentOpenRouterModelsPromise;
}

export function resetModelMetadata(): void {
  currentOpenAiModelsPromise = null;
  currentOpenRouterModelsPromise = null;
}

/** Model-id prefixes that denote an OpenAI text/chat-generation family. */
const TEXT_MODEL_PREFIXES = ["gpt", "chatgpt", "o1", "o3", "o4"] as const;

/** Substrings that mark a non-text OpenAI model even when the prefix matches. */
const NON_TEXT_MARKERS = [
  "embedding",
  "audio",
  "tts",
  "whisper",
  "transcribe",
  "realtime",
  "image",
  "dall-e",
  "moderation",
] as const;

/** Keep only text/chat-generation model ids from OpenAI's model list. */
export function filterTextModels(ids: string[]): string[] {
  const kept = ids.filter((id) => {
    const lower = id.toLowerCase();
    const isTextFamily = TEXT_MODEL_PREFIXES.some((prefix) =>
      lower.startsWith(prefix),
    );
    const isNonText = NON_TEXT_MARKERS.some((marker) => lower.includes(marker));
    return isTextFamily && !isNonText;
  });
  return uniq(kept).sort();
}

export interface OpenRouterModelInfo {
  id: string;
  context_length: number;
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
  };
  supported_parameters: string[];
}

interface OpenRouterModelsResponse {
  data: OpenRouterModelInfo[];
}

interface OpenAiModelsResponse {
  data: { id: string }[];
}

/** Keep OpenRouter text models that can run the app's agent tools. */
export function filterOpenRouterTextModels(
  models: OpenRouterModelInfo[],
): string[] {
  const kept = models
    .filter(
      (model) =>
        model.context_length > 0 &&
        model.architecture.input_modalities.includes("text") &&
        model.architecture.output_modalities.includes("text") &&
        model.supported_parameters.includes("tools"),
    )
    .map((model) => model.id);
  return uniq(kept).sort();
}

async function listOpenAiTextModels(): Promise<string[]> {
  const { apiKey } = await getAiConfig("openai");
  const response = await fetchModelResponse<OpenAiModelsResponse>(
    OPENAI_MODELS_ENDPOINT,
    apiKey,
  );
  return filterTextModels(response.data.map((model) => model.id));
}

async function listOpenRouterTextModels(): Promise<string[]> {
  const { apiKey } = await getAiConfig("openrouter");
  return filterOpenRouterTextModels(await currentOpenRouterModels(apiKey));
}

const modelListers: Record<AiProvider, () => Promise<string[]>> = {
  openai: listOpenAiTextModels,
  openrouter: listOpenRouterTextModels,
};

export function listTextModels(provider: AiProvider): Promise<string[]> {
  return modelListers[provider]();
}

async function resolveOpenAiContextWindow(modelId: string): Promise<number> {
  const bundled = modelContextWindow(modelId, null);
  if (bundled !== null) return bundled;
  const current = modelContextWindow(modelId, await currentOpenAiModels());
  if (current === null) {
    throw new Error(`No context-window metadata for model: ${modelId}`);
  }
  return current;
}

async function resolveOpenRouterContextWindow(modelId: string): Promise<number> {
  const { apiKey } = await getAiConfig("openrouter");
  const model = (await currentOpenRouterModels(apiKey)).find(
    (candidate) => candidate.id === modelId,
  );
  if (model === undefined || model.context_length <= 0) {
    throw new Error(`No context-window metadata for model: ${modelId}`);
  }
  return model.context_length;
}

const contextWindowResolvers: Record<
  AiProvider,
  (modelId: string) => Promise<number>
> = {
  openai: resolveOpenAiContextWindow,
  openrouter: resolveOpenRouterContextWindow,
};

export function resolveModelContextWindow(
  provider: AiProvider,
  modelId: string,
): Promise<number> {
  return contextWindowResolvers[provider](modelId);
}
