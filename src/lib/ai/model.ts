// model.ts - resolves the active language model, dispatching on the selected
// AI provider (`settings-store.aiProvider`). Both families are returned behind
// the Vercel AI SDK's LanguageModel interface so callers see one shape.
//
//   - OpenAI (`aiProvider === "openai"`): the Vercel AI SDK (`ai` +
//     `@ai-sdk/openai`). Two deliberate choices reconcile it with the Tauri
//     secrets rule: (1) the API key is read on the RUST side (`get_ai_config`)
//     from the value the user saved in Settings and handed over at runtime,
//     never inlined into frontend source or the bundle; (2) HTTP egress is
//     routed through Tauri's http plugin `fetch`, not the webview's global
//     fetch, to bypass webview CORS (OpenAI sends no CORS headers) uniformly
//     across WebKitGTK / WKWebView / WebView2. The model is NOT hardcoded; until
//     the user picks one, `getModel()` throws so AI features cannot run.
//   - Codex / Claude (`aiProvider === "codex" | "claude"`): the local-CLI
//     LanguageModelV3 adapter in `cli-provider.ts`. No HTTP - generation runs
//     through the Rust `cli_generate` command driving the CLI's own
//     subscription, and no model needs to be selected, so the OpenAI throw does
//     not apply to this path.

import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAiConfig } from "@/lib/tauri";
import { createCliModel } from "@/lib/ai/cli-provider";
import { useSettingsStore } from "@/stores/settings-store";

let providerPromise: Promise<OpenAIProvider> | null = null;

/** Lazily build the OpenAI provider, fetching the key from Rust exactly once. */
function getProvider(): Promise<OpenAIProvider> {
  if (!providerPromise) {
    providerPromise = (async () => {
      const { apiKey } = await getAiConfig();
      return createOpenAI({
        apiKey,
        // Route through Rust so we are not subject to webview CORS.
        fetch: tauriFetch as unknown as typeof globalThis.fetch,
      });
    })().catch((err) => {
      // Reset so a transient failure (e.g. key not yet available) can retry.
      providerPromise = null;
      throw err;
    });
  }
  return providerPromise;
}

/**
 * Drop the cached provider so the next AI call rebuilds it with a freshly read
 * key. Call this after the key changes in Settings - otherwise a provider built
 * with the old key (or no key) would persist for the rest of the session.
 */
export function resetAiProvider(): void {
  providerPromise = null;
}

/**
 * The configured language model, ready to pass to generateText/streamText.
 * Throws when no model is selected in Settings - AI is unusable until then.
 */
export async function getModel(): Promise<LanguageModel> {
  const { aiProvider, aiModel } = useSettingsStore.getState();
  if (aiProvider === "codex" || aiProvider === "claude") {
    return createCliModel(aiProvider);
  }
  if (!aiModel) {
    throw new Error("Select an AI model in Settings before using AI features.");
  }
  const provider = await getProvider();
  return provider(aiModel);
}
