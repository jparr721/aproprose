// model.ts — the single source of the AI model + provider.
//
// ALL AI operations in the app go through the Vercel AI SDK (`ai` + `@ai-sdk/openai`).
// Two deliberate choices reconcile the SDK with the Tauri secrets rule:
//
//   1. The API key is read from .env on the RUST side (`get_ai_config`) and handed
//      over at runtime — it is never inlined into frontend source or the bundle.
//   2. HTTP egress is routed through Tauri's http plugin `fetch`, not the webview's
//      global fetch. That bypasses webview CORS (OpenAI doesn't send CORS headers)
//      and works uniformly across WebKitGTK / WKWebView / WebView2.
//
// The model is pinned per the product requirement: the newest available `nano`
// tier. (`gpt-5.5-nano` does not exist; verified against the models endpoint — the
// 5.5 family ships only base + pro, so the newest nano is gpt-5.4-nano.)

import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAiConfig } from "@/lib/tauri";

/** The one model id used for every AI operation. */
export const AI_MODEL = "gpt-5.4-nano" as const;

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
 * key. Call this after the key changes in Settings — otherwise a provider built
 * with the old key (or no key) would persist for the rest of the session.
 */
export function resetAiProvider(): void {
  providerPromise = null;
}

/** The configured language model, ready to pass to generateObject/streamText. */
export async function getModel() {
  const provider = await getProvider();
  return provider(AI_MODEL);
}
