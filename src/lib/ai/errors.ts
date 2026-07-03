// errors.ts — turn an unknown thrown value into the most informative string we
// can, without losing detail.
//
// AI calls (Vercel `ai` + `@ai-sdk/openai`, routed through Tauri's HTTP plugin)
// reject with errors that carry an HTTP status code, the upstream response body,
// and a cause chain. A bare `String(e)` collapses those to just the top-line
// message, hiding whether a failure was auth (401), rate limit (429), a malformed
// request (400), or a network drop — exactly the detail you need to act on.

import { toast } from "sonner";

export function describeAiError(e: unknown): string {
  if (typeof e === "string") return e;

  if (e instanceof Error) {
    // AI SDK errors (APICallError et al.) are real Errors that also carry these
    // fields; duck-type them rather than importing provider internals. (`cause`
    // is in the cast too: this project targets the ES2020 lib, which doesn't yet
    // declare the standard Error.cause.)
    const err = e as Error & {
      statusCode?: number;
      status?: number;
      responseBody?: string;
      cause?: unknown;
    };
    const parts: string[] = [];
    // Append a fragment unless something we've already shown contains it, so an
    // SDK that echoes the body (or cause) into the message isn't repeated. This
    // dedupes literal repeats only — every distinct piece of detail is kept.
    const push = (s: string | undefined) => {
      const v = s?.trim();
      if (v && !parts.some((p) => p.includes(v))) parts.push(v);
    };

    const status = err.statusCode ?? err.status;
    if (status != null) parts.push(`HTTP ${status}`);
    push(err.message || err.name || "Error");
    push(err.responseBody);
    if (err.cause != null && err.cause !== e) {
      const cause = (err.cause instanceof Error ? err.cause.message : String(err.cause)).trim();
      if (cause && !parts.some((p) => p.includes(cause))) parts.push(`cause: ${cause}`);
    }
    return parts.join(" — ");
  }

  // Non-Error throw: keep the structure instead of collapsing to "[object Object]".
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** True for the abort shapes an in-flight AI call surfaces when its
 *  AbortSignal fires (the SDK rethrows the DOMException named "AbortError"). */
export function isAbortError(e: unknown): boolean {
  return (e instanceof DOMException || e instanceof Error) && e.name === "AbortError";
}

/**
 * Run an AI call with ONE retry. Aborts rethrow immediately - the author
 * cancelled, so retrying would be hostile. On the first real failure, warn and
 * try once more; a second failure rethrows to the caller's error surface.
 */
export async function withAiRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (first) {
    if (isAbortError(first)) throw first;
    toast.warning("AI request failed - retrying");
    return await fn();
  }
}
