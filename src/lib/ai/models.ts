// models.ts - list the OpenAI models the user's key can use, for the Settings
// picker. The key is resolved on the Rust side (getAiConfig) and HTTP egress is
// routed through Tauri's http plugin, exactly like the provider in ./model.ts,
// so this dodges webview CORS and never inlines the key into the bundle.

import { uniq } from "es-toolkit";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAiConfig } from "@/lib/tauri";

const MODELS_ENDPOINT = "https://api.openai.com/v1/models";

/** Model-id prefixes that denote a text/chat-generation family. */
const TEXT_MODEL_PREFIXES = ["gpt", "chatgpt", "o1", "o3", "o4"] as const;

/** Substrings that mark a non-text model even when the prefix matches. */
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

/**
 * Keep only text/chat-generation model ids. /v1/models carries no capability
 * metadata, so we filter heuristically by id: an allowlist of family prefixes
 * minus a denylist of substrings for audio/image/embedding/etc. The result is
 * de-duplicated and sorted ascending.
 */
export function filterTextModels(ids: string[]): string[] {
  const kept = ids.filter((id) => {
    const lower = id.toLowerCase();
    const isTextFamily = TEXT_MODEL_PREFIXES.some((p) => lower.startsWith(p));
    const isNonText = NON_TEXT_MARKERS.some((m) => lower.includes(m));
    return isTextFamily && !isNonText;
  });
  return uniq(kept).sort();
}

interface ModelsResponse {
  data: { id: string }[];
}

/**
 * Fetch the text-capable OpenAI models available to the configured key. Relies
 * on getAiConfig() to throw an actionable "add a key in Settings" error when no
 * key is set; throws on a non-2xx response with the status + body.
 */
export async function listTextModels(): Promise<string[]> {
  const { apiKey } = await getAiConfig();
  const res = await tauriFetch(MODELS_ENDPOINT, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} - ${body}`);
  }
  const json = (await res.json()) as ModelsResponse;
  return filterTextModels(json.data.map((m) => m.id));
}
