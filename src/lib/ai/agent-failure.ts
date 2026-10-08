import { z } from "zod";
import type {
  AgentErrorCode,
  AgentFailure,
  AgentFailureReason,
} from "@/lib/ai/agent-types";
import type { AiProvider } from "@/lib/types";

const errorDetailsSchema = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  statusCode: z.number().optional(),
  status: z.number().optional(),
  responseBody: z.string().optional(),
  isRetryable: z.boolean().optional(),
  failure: z.unknown().optional(),
  agentFailureReason: z.unknown().optional(),
  lastError: z.unknown().optional(),
  cause: z.unknown().optional(),
});

const failureReasonSchema = z.enum([
  "model-unselected",
  "key-missing",
  "key-rejected",
  "model-unavailable",
  "settings-unavailable",
  "quota",
  "transport",
  "tool",
  "compaction",
  "transition",
  "unknown",
]);

export interface AiErrorClassification {
  failure: AgentFailure;
  retryable: boolean;
}

export type AgentFailurePhase = "compaction" | null;

const providerLabels: Record<AiProvider, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

function providerLabel(provider: AiProvider | null): string {
  return provider === null ? "AI provider" : providerLabels[provider];
}

function failure(
  reason: AgentFailureReason,
  message: string,
  action: AgentFailure["action"],
  settingsTarget: AgentFailure["settingsTarget"],
): AgentFailure {
  return { reason, message, action, settingsTarget };
}

export function modelUnselectedFailure(
  provider: AiProvider | null,
): AgentFailure {
  return failure(
    "model-unselected",
    `Choose a model for ${providerLabel(provider)}, then submit again.`,
    "choose-model",
    "model",
  );
}

export function keyMissingFailure(provider: AiProvider | null): AgentFailure {
  return failure(
    "key-missing",
    `Add an ${providerLabel(provider)} key, then submit again.`,
    "add-key",
    "key",
  );
}

export function keyRejectedFailure(provider: AiProvider | null): AgentFailure {
  return failure(
    "key-rejected",
    `Replace the ${providerLabel(provider)} key, then submit again.`,
    "replace-key",
    "key",
  );
}

export function modelUnavailableFailure(
  provider: AiProvider | null,
): AgentFailure {
  return failure(
    "model-unavailable",
    `The selected ${providerLabel(provider)} model is unavailable. Choose another model, then submit again.`,
    "choose-model",
    "model",
  );
}

export function settingsUnavailableFailure(): AgentFailure {
  return failure(
    "settings-unavailable",
    "AI settings are unavailable. Retry.",
    "retry",
    null,
  );
}

export function legacyAgentFailure(): AgentFailure {
  return failure(
    "unknown",
    "A previous AI request could not be completed. Retry the request.",
    "retry",
    null,
  );
}

export function agentFailureFromReason(
  reason: AgentFailureReason,
  provider: AiProvider | null,
): AgentFailure {
  switch (reason) {
    case "model-unselected":
      return modelUnselectedFailure(provider);
    case "key-missing":
      return keyMissingFailure(provider);
    case "key-rejected":
      return keyRejectedFailure(provider);
    case "model-unavailable":
      return modelUnavailableFailure(provider);
    case "settings-unavailable":
      return settingsUnavailableFailure();
    case "quota":
      return failure(
        "quota",
        "Your AI provider account has no credits remaining. Add credits and retry.",
        "retry",
        null,
      );
    case "transport":
      return failure(
        "transport",
        "The AI request could not be completed. Check your connection and retry.",
        "retry",
        null,
      );
    case "tool":
      return failure(
        "tool",
        "A project action could not be completed. Retry the request.",
        "retry",
        null,
      );
    case "compaction":
      return failure(
        "compaction",
        "Older conversation context could not be prepared. Retry the request.",
        "retry",
        null,
      );
    case "transition":
      return failure(
        "transition",
        "The AI conversation is loading for this project. Retry when loading finishes.",
        "retry",
        null,
      );
    case "unknown":
      return failure(
        "unknown",
        "The AI request could not be completed. Retry the request.",
        "retry",
        null,
      );
  }
}

export function agentFailureFromLegacyCode(
  code: AgentErrorCode | null | undefined,
  provider: AiProvider,
): AgentFailure {
  switch (code) {
    case "quota":
    case "transport":
    case "tool":
    case "compaction":
    case "transition":
      return agentFailureFromReason(code, provider);
    case "configuration":
      return agentFailureFromReason("settings-unavailable", provider);
    case "unknown":
    case null:
    case undefined:
      return agentFailureFromReason("unknown", provider);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureFromDescriptor(
  value: unknown,
  provider: AiProvider | null,
): AgentFailure | null {
  if (!isRecord(value)) return null;
  const parsed = failureReasonSchema.safeParse(value.reason);
  return parsed.success ? agentFailureFromReason(parsed.data, provider) : null;
}

export function classifyAiError(
  error: unknown,
  provider: AiProvider | null,
  phase: AgentFailurePhase,
): AiErrorClassification {
  let current: unknown = error;
  const seen = new Set<unknown>();
  let details: z.infer<typeof errorDetailsSchema> = {};
  while (!seen.has(current)) {
    seen.add(current);
    const parsed = errorDetailsSchema.safeParse(
      typeof current === "string" ? { message: current } : current,
    );
    if (!parsed.success) break;
    details = parsed.data;
    const direct =
      failureFromDescriptor(details.failure, provider) ??
      failureFromDescriptor({ reason: details.agentFailureReason }, provider);
    if (direct !== null) return { failure: direct, retryable: false };
    const nested = details.lastError ?? details.cause;
    if (
      nested === undefined ||
      nested === null ||
      seen.has(nested) ||
      details.statusCode !== undefined ||
      details.status !== undefined ||
      /NoObjectGenerated|NoOutputGenerated|TypeValidation|JSONParse|InvalidTool|NoSuchTool|ToolCall/.test(
        details.name ?? "",
      )
    )
      break;
    current = nested;
  }

  const status = details.statusCode ?? details.status;
  const retryable = details.isRetryable !== false;
  const message =
    `${details.message ?? ""} ${details.responseBody ?? ""}`.toLowerCase();
  const name = details.name ?? "";
  if (
    status === 402 ||
    /credit_balance_exhausted|insufficient_quota|no credits remaining|insufficient credits/.test(
      message,
    )
  ) {
    return {
      failure: agentFailureFromReason("quota", provider),
      retryable: false,
    };
  }
  if (
    /LoadAPIKey/.test(name) ||
    /api key is missing|api key must be set|no api key/.test(message)
  ) {
    return { failure: keyMissingFailure(provider), retryable: false };
  }
  if (
    status === 401 ||
    /invalid[_ ]api[_ ]key|incorrect api key|unauthorized|authentication_error/.test(
      message,
    )
  ) {
    return { failure: keyRejectedFailure(provider), retryable: false };
  }
  if (
    /content_policy|content_filter|moderation|safety.*blocked/.test(message)
  ) {
    return {
      failure: failure(
        "unknown",
        "Your AI provider blocked this request under its content policy. Revise the request and retry.",
        null,
        null,
      ),
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      failure: failure(
        "unknown",
        "Your AI provider denied this request. Check your account permissions and model access.",
        null,
        null,
      ),
      retryable: false,
    };
  }
  if (
    status === 413 ||
    /context_length_exceeded|maximum context length|context (window|length|limit).*exceed|too many tokens/.test(
      message,
    )
  ) {
    return {
      failure: failure(
        "unknown",
        "This request exceeds the model's context limit. Shorten the conversation or choose a model with a larger context window.",
        "choose-model",
        "model",
      ),
      retryable: false,
    };
  }
  if (
    status === 404 ||
    /context-window metadata|model[_ ]not[_ ]found|model unavailable|no endpoints found/.test(
      message,
    )
  ) {
    return { failure: modelUnavailableFailure(provider), retryable: false };
  }
  if (
    /UnsupportedFunctionality|UnsupportedModelVersion|NoSuchModel/.test(name) ||
    /does not support|unsupported (model|parameter|function)/.test(message)
  ) {
    return {
      failure: failure(
        "model-unavailable",
        "The selected AI model does not support this operation. Choose another model.",
        "choose-model",
        "model",
      ),
      retryable: false,
    };
  }
  if (status === 400 || status === 422) {
    return {
      failure: failure(
        "unknown",
        "Your AI provider rejected the request format or parameters. Change the request or choose another model.",
        "choose-model",
        "model",
      ),
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      failure: failure(
        "transport",
        "Your AI provider is rate limiting requests. Wait a moment and retry.",
        "retry",
        null,
      ),
      retryable,
    };
  }
  if (
    status === 408 ||
    status === 504 ||
    /Timeout/.test(name) ||
    /timed? out|timeout/.test(message)
  ) {
    return {
      failure: failure(
        "transport",
        "The AI request timed out. Check your connection and retry.",
        "retry",
        null,
      ),
      retryable,
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      failure: failure(
        "transport",
        "Your AI provider is temporarily unavailable. Retry shortly.",
        "retry",
        null,
      ),
      retryable,
    };
  }
  if (status === 409) {
    return {
      failure: failure(
        "transport",
        "Your AI provider could not process this request because of a conflict. Retry the request.",
        "retry",
        null,
      ),
      retryable,
    };
  }
  const responseCause = errorDetailsSchema.safeParse(details.cause);
  if (
    /NoObjectGenerated|NoOutputGenerated|EmptyResponseBody|InvalidResponseData|JSONParse|TypeValidation/.test(
      name,
    ) ||
    (status !== undefined &&
      status >= 200 &&
      status < 300 &&
      responseCause.success &&
      /JSONParse|TypeValidation/.test(responseCause.data.name ?? ""))
  ) {
    return {
      failure: failure(
        "transport",
        "Your AI provider returned an empty or invalid response. Retry the request.",
        "retry",
        null,
      ),
      retryable,
    };
  }
  if (/InvalidTool|NoSuchTool|ToolCall/.test(name)) {
    return {
      failure: agentFailureFromReason("tool", provider),
      retryable: false,
    };
  }
  if (
    /fetch failed|failed to fetch|network|connection|error sending request|dns|tls|certificate|econn/.test(
      message,
    ) ||
    (/APICallError|DownloadError/.test(name) && status === undefined)
  ) {
    return {
      failure: agentFailureFromReason("transport", provider),
      retryable,
    };
  }
  if (phase === "compaction") {
    return {
      failure: agentFailureFromReason("compaction", provider),
      retryable: false,
    };
  }
  return {
    failure: agentFailureFromReason("unknown", provider),
    retryable: false,
  };
}

export function failureFromError(
  error: unknown,
  provider: AiProvider | null,
  phase: AgentFailurePhase,
): AgentFailure {
  return classifyAiError(error, provider, phase).failure;
}

export function agentFailureDiagnosticCode(
  agentFailure: AgentFailure,
): AgentErrorCode {
  switch (agentFailure.reason) {
    case "model-unselected":
    case "key-missing":
    case "key-rejected":
    case "model-unavailable":
    case "settings-unavailable":
      return "configuration";
    case "quota":
    case "transport":
    case "tool":
    case "compaction":
    case "transition":
    case "unknown":
      return agentFailure.reason;
  }
}

export function agentFailureActionLabel(
  failure: AgentFailure,
): string | null {
  switch (failure.action) {
    case "add-key":
      return "Add key";
    case "replace-key":
      return "Replace key";
    case "choose-model":
      return failure.reason === "model-unavailable"
        ? "Choose another model"
        : "Choose model";
    case "retry":
    case null:
      return null;
  }
}
