import { describe, expect, it } from "vitest";
import {
  APICallError,
  JSONParseError,
  TypeValidationError,
} from "@ai-sdk/provider";
import { InvalidToolInputError, ToolCallRepairError } from "ai";
import {
  agentFailureActionLabel,
  failureFromError,
  classifyAiError,
  modelUnavailableFailure,
  modelUnselectedFailure,
} from "@/lib/ai/agent-failure";

describe("agent failure normalization", () => {
  it("recognizes malformed JSON in a successful SDK HTTP response", () => {
    const error = new APICallError({
      message: "Invalid JSON response",
      url: "https://private.example",
      requestBodyValues: undefined,
      statusCode: 200,
      cause: new JSONParseError({
        text: "private response",
        cause: new SyntaxError("Invalid JSON"),
      }),
    });
    expect(classifyAiError(error, "openai", null)).toMatchObject({
      failure: {
        message: expect.stringContaining("empty or invalid response"),
      },
    });
  });

  const invalidToolInput = new InvalidToolInputError({
    toolName: "read_chapter",
    toolInput: "{}",
    cause: new TypeValidationError({
      value: {},
      cause: new Error("private schema detail"),
    }),
  });
  it.each([
    invalidToolInput,
    new ToolCallRepairError({
      originalError: invalidToolInput,
      cause: new TypeValidationError({
        value: {},
        cause: new Error("private schema detail"),
      }),
    }),
  ])("preserves tool failure identity through validation causes", (error) => {
    expect(classifyAiError(error, "openai", null)).toMatchObject({
      failure: { reason: "tool" },
      retryable: false,
    });
  });

  it("distinguishes request quotas from exhausted billing credits", () => {
    const error = Object.assign(
      new Error("Quota exceeded for requests per minute"),
      { statusCode: 429 },
    );
    expect(classifyAiError(error, "openai", null)).toMatchObject({
      failure: { message: expect.stringContaining("rate limiting") },
      retryable: true,
    });
  });
  it.each([
    ["rate limit", { statusCode: 429 }, "rate limiting"],
    ["permission denial", { statusCode: 403 }, "permissions"],
    ["server outage", { statusCode: 503 }, "temporarily unavailable"],
    ["timeout", { statusCode: 408 }, "timed out"],
    ["gateway timeout", { statusCode: 504 }, "timed out"],
    [
      "context limit",
      {
        statusCode: 400,
        responseBody: '{"error":{"code":"context_length_exceeded"}}',
      },
      "context limit",
    ],
    ["oversized request", { statusCode: 413 }, "context limit"],
    ["invalid request", { statusCode: 422 }, "request format"],
    [
      "content policy",
      {
        statusCode: 400,
        responseBody: '{"error":{"code":"content_policy_violation"}}',
      },
      "content policy",
    ],
    [
      "invalid output",
      { name: "AI_NoObjectGeneratedError" },
      "empty or invalid response",
    ],
    [
      "unsupported operation",
      { name: "AI_UnsupportedFunctionalityError" },
      "does not support",
    ],
    [
      "plain string network error",
      "error sending request for url (https://private.example)",
      "connection",
    ],
    [
      "wrapped auth",
      { name: "AI_RetryError", lastError: { statusCode: 401 } },
      "Replace the OpenAI key",
    ],
    [
      "nested quota",
      new Error("request failed", { cause: { statusCode: 402 } }),
      "credits",
    ],
    [
      "quota body",
      {
        statusCode: 429,
        responseBody: '{"error":{"code":"insufficient_quota"}}',
      },
      "credits",
    ],
    ["missing SDK key", { name: "AI_LoadAPIKeyError" }, "Add an OpenAI key"],
  ])(
    "explains %s without leaking provider diagnostics",
    (_case, error, message) => {
      const failure = failureFromError(error, "openai", null);
      expect(failure.message).toContain(message);
      expect(failure.message).not.toContain("private.example");
      expect(failure.message).not.toContain("context_length_exceeded");
    },
  );

  it("terminates cyclic cause chains safely", () => {
    const error = new Error("private diagnostic");
    error.cause = error;
    expect(failureFromError(error, "openai", null).reason).toBe("unknown");
  });
  it("gives an OpenRouter model selection a provider-specific safe action", () => {
    expect(modelUnselectedFailure("openrouter")).toEqual({
      reason: "model-unselected",
      message: "Choose a model for OpenRouter, then submit again.",
      action: "choose-model",
      settingsTarget: "model",
    });
  });

  it("uses a distinct recovery label for an unavailable selected model", () => {
    expect(agentFailureActionLabel(modelUnavailableFailure("openrouter"))).toBe(
      "Choose another model",
    );
  });

  it.each([
    [
      "missing key",
      { name: "AiConfigFailure", failure: { reason: "key-missing" } },
      "key-missing",
    ],
    [
      "rejected key",
      Object.assign(new Error("Unauthorized"), { status: 401 }),
      "key-rejected",
    ],
    [
      "unavailable model",
      new Error("No context-window metadata for model: private-model"),
      "model-unavailable",
    ],
    [
      "quota",
      Object.assign(new Error("insufficient_quota"), { status: 402 }),
      "quota",
    ],
    [
      "transport",
      Object.assign(new Error("provider unavailable"), { status: 503 }),
      "transport",
    ],
    [
      "compaction retains quota cause",
      Object.assign(new Error("insufficient_quota"), { status: 402 }),
      "quota",
    ],
  ])("normalizes %s without exposing raw detail", (_case, error, reason) => {
    const failure = failureFromError(
      error,
      "openai",
      _case === "compaction retains quota cause" ? "compaction" : null,
    );

    expect(failure.reason).toBe(reason);
    expect(failure.message).not.toContain("private-model");
    expect(failure.message).not.toContain("insufficient_quota");
  });
});
