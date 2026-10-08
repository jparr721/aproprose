import { toast } from "sonner";
import { openNotifications } from "@/lib/notifications";
import { classifyAiError, failureFromError } from "@/lib/ai/agent-failure";
import type { AgentFailure } from "@/lib/ai/agent-types";
import type { AiProvider } from "@/lib/types";
import { useSettingsDialogStore } from "@/stores/settings-dialog-store";

export function describeAiError(error: unknown): string {
  return failureFromError(error, null, null).message;
}

export function showAiError(
  error: unknown,
  provider: AiProvider | null,
): AgentFailure {
  const failure = failureFromError(error, provider, null);
  const target = failure.settingsTarget;
  toast.error(failure.message, {
    id: "ai-request-error",
    action:
      target === null
        ? { label: "View notification", onClick: openNotifications }
        : {
            label: "Open AI settings",
            onClick: () =>
              useSettingsDialogStore.getState().openAiSettings(target),
          },
  });
  return failure;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    error.name === "AbortError"
  );
}

export async function withAiRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (first) {
    if (isAbortError(first)) throw first;
    const classified = classifyAiError(first, null, null);
    if (!classified.retryable) {
      showAiError(first, null);
      throw first;
    }
    toast.warning(classified.failure.message, {
      id: "ai-request-retry",
      description: "Retrying once.",
    });
    try {
      return await fn();
    } catch (last) {
      if (!isAbortError(last)) showAiError(last, null);
      throw last;
    }
  }
}
