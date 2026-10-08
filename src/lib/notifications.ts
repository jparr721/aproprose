import { toast } from "sonner";
import { classifyAiError } from "@/lib/ai/agent-failure";
import type { AgentFailurePhase } from "@/lib/ai/agent-failure";
import type { AiProvider } from "@/lib/types";
import {
  NOTIFICATION_DEFINITIONS,
  type AppNotificationType,
  type NotificationInput,
} from "@/lib/notification-model";
import { useNotificationStore } from "@/stores/notification-store";
import {
  SETTINGS_TABS,
  useSettingsDialogStore,
} from "@/stores/settings-dialog-store";

export function openNotifications(): void {
  useSettingsDialogStore.getState().openWithTab(SETTINGS_TABS.NOTIFICATIONS);
}

export function reportNotification(input: NotificationInput): void {
  useNotificationStore.getState().record(input);
}

export function notifyAppError(
  type: AppNotificationType,
  source: string,
  projectRoot: string | null,
  error: unknown,
): void {
  console.error("App operation failed", { type, source, projectRoot, error });
  reportNotification({ type, source, projectRoot, provider: null });
  toast.error(NOTIFICATION_DEFINITIONS[type].title, {
    id: JSON.stringify([type, source, projectRoot]),
    action: { label: "View notification", onClick: openNotifications },
  });
}

export function reportAiError(
  error: unknown,
  provider: AiProvider | null,
  source: string,
  projectRoot: string | null,
  phase: AgentFailurePhase,
): void {
  const classified = classifyAiError(error, provider, phase);
  reportNotification({
    type: `ai-${classified.type}`,
    source,
    projectRoot,
    provider,
  });
}
