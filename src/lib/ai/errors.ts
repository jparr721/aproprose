// errors.ts — turn an unknown thrown value into the most informative string we
// can, without losing detail.
//
// AI calls (Vercel `ai` + `@ai-sdk/openai`, routed through Tauri's HTTP plugin)
// reject with errors that carry an HTTP status code and the upstream response
// body. A bare `String(e)` collapses those to just the top-line message, hiding
// whether a failure was auth (401), rate limit (429), a malformed request (400),
// or a network drop — exactly the detail you need to act on. This keeps it.

export function describeAiError(e: unknown): string {
  if (typeof e === "string") return e;

  if (e instanceof Error) {
    // AI SDK errors (APICallError et al.) are real Errors that also carry these
    // fields; duck-type them rather than importing provider internals.
    const err = e as Error & {
      statusCode?: number;
      status?: number;
      responseBody?: string;
      cause?: unknown;
    };
    const parts: string[] = [];
    const status = err.statusCode ?? err.status;
    if (status != null) parts.push(`HTTP ${status}`);
    parts.push(err.message || err.name || "Error");
    if (err.responseBody && !err.message.includes(err.responseBody)) {
      parts.push(err.responseBody);
    }
    if (err.cause != null && err.cause !== e) {
      const cause = err.cause instanceof Error ? err.cause.message : String(err.cause);
      if (cause && !err.message.includes(cause)) parts.push(`cause: ${cause}`);
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
