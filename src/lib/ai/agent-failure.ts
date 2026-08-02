import type {
  AgentErrorCode,
  AgentFailure,
  AgentFailureReason,
} from "@/lib/ai/agent-types";
import type { AiProvider } from "@/lib/types";

interface ErrorDetails extends Error {
  statusCode?: number;
  status?: number;
  failure?: unknown;
  agentFailureReason?: unknown;
}

export type AgentFailurePhase = "compaction" | null;

const providerLabels: Record<AiProvider, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

function failure(
  reason: AgentFailureReason,
  message: string,
  action: AgentFailure["action"],
  settingsTarget: AgentFailure["settingsTarget"],
): AgentFailure {
  return { reason, message, action, settingsTarget };
}

export function modelUnselectedFailure(provider: AiProvider): AgentFailure {
  return failure(
    "model-unselected",
    `Choose a model for ${providerLabels[provider]}, then submit again.`,
    "choose-model",
    "model",
  );
}

export function keyMissingFailure(provider: AiProvider): AgentFailure {
  return failure(
    "key-missing",
    `Add an ${providerLabels[provider]} key, then submit again.`,
    "add-key",
    "key",
  );
}

export function keyRejectedFailure(provider: AiProvider): AgentFailure {
  return failure(
    "key-rejected",
    `Replace the ${providerLabels[provider]} key, then submit again.`,
    "replace-key",
    "key",
  );
}

export function modelUnavailableFailure(provider: AiProvider): AgentFailure {
  return failure(
    "model-unavailable",
    `The selected ${providerLabels[provider]} model is unavailable. Choose another model, then submit again.`,
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
  provider: AiProvider,
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
  provider: AiProvider,
): AgentFailure | null {
  if (!isRecord(value) || typeof value.reason !== "string") return null;
  const reason = value.reason as AgentFailureReason;
  const known = new Set<AgentFailureReason>([
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
  return known.has(reason) ? agentFailureFromReason(reason, provider) : null;
}

function errorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const detailed = error as ErrorDetails;
  return detailed.statusCode ?? detailed.status ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : "";
}

export function failureFromError(
  error: unknown,
  provider: AiProvider,
  phase: AgentFailurePhase,
): AgentFailure {
  const direct =
    error instanceof Error
      ? failureFromDescriptor((error as ErrorDetails).failure, provider) ??
        failureFromDescriptor(
          { reason: (error as ErrorDetails).agentFailureReason },
          provider,
        )
      : failureFromDescriptor(
          isRecord(error) ? error.failure : undefined,
          provider,
        );
  if (direct !== null) return direct;

  const status = errorStatus(error);
  const message = errorMessage(error);
  if (
    status === 402 ||
    message.includes("credit_balance_exhausted") ||
    message.includes("insufficient_quota") ||
    message.includes("no credits remaining")
  ) {
    return agentFailureFromReason("quota", provider);
  }
  if (
    status === 401 ||
    status === 403 ||
    message.includes("invalid api key") ||
    message.includes("unauthorized")
  ) {
    return keyRejectedFailure(provider);
  }
  if (
    status === 404 ||
    message.includes("context-window metadata") ||
    message.includes("model not found") ||
    message.includes("model unavailable")
  ) {
    return modelUnavailableFailure(provider);
  }
  if (
    error instanceof Error &&
    (error.name.includes("InvalidTool") ||
      error.name.includes("NoSuchTool") ||
      error.name.includes("ToolCall"))
  ) {
    return agentFailureFromReason("tool", provider);
  }
  if (
    status !== null ||
    (error instanceof Error &&
      (error.name.includes("APICallError") ||
        error.name.includes("RetryError") ||
        error.name.includes("DownloadError") ||
        error.name.includes("EmptyResponseBodyError")))
  ) {
    return agentFailureFromReason("transport", provider);
  }
  if (phase === "compaction") {
    return agentFailureFromReason("compaction", provider);
  }
  return agentFailureFromReason("unknown", provider);
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
