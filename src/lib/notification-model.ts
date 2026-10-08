import { z } from "zod";
import type { AiErrorType } from "@/lib/ai/agent-failure";

interface NotificationDefinition {
  title: string;
  steps: string;
  action: "key" | "model" | "backup" | "build-log" | null;
}

const aiDefinitions = {
  "ai-model-unselected": {
    title: "Choose an AI model",
    steps:
      "Open AI settings, select a provider and model, then repeat the request.",
    action: "model",
  },
  "ai-key-missing": {
    title: "AI key missing",
    steps:
      "Add a key for this provider in AI settings, then repeat the request.",
    action: "key",
  },
  "ai-key-rejected": {
    title: "AI key rejected",
    steps:
      "Your provider did not recognize the key or account. Replace this provider's key in AI settings, then repeat the request.",
    action: "key",
  },
  "ai-model-unavailable": {
    title: "AI model unavailable",
    steps:
      "Choose another model supported by your provider account, then repeat the request.",
    action: "model",
  },
  "ai-settings-unavailable": {
    title: "AI settings unavailable",
    steps:
      "Reopen AI settings and retry. If settings still cannot be read or saved, restart Aproprose and check access to its app configuration folder.",
    action: "key",
  },
  "ai-quota": {
    title: "AI credits exhausted",
    steps:
      "Check billing and add credits in your provider account, then repeat the request.",
    action: "key",
  },
  "ai-transport": {
    title: "AI connection failed",
    steps:
      "Check your internet connection and access to your provider, then repeat the request.",
    action: null,
  },
  "ai-tool": {
    title: "AI project action failed",
    steps:
      "Check that the requested chapter or selection still exists, then repeat the request with its current context.",
    action: null,
  },
  "ai-compaction": {
    title: "AI conversation preparation failed",
    steps:
      "Retry the request. If it keeps failing, start a new conversation with the context you need.",
    action: null,
  },
  "ai-transition": {
    title: "AI conversation still loading",
    steps:
      "Wait for this project's conversation to finish loading, then repeat the request.",
    action: null,
  },
  "ai-unknown": {
    title: "AI request failed",
    steps:
      "Repeat the request. If it continues to fail, check your provider and selected model in AI settings.",
    action: "model",
  },
  "ai-content-policy": {
    title: "AI request blocked",
    steps:
      "Your provider blocked the request under its content policy. Revise the request before trying again.",
    action: null,
  },
  "ai-permission": {
    title: "AI access denied",
    steps:
      "Check your provider account permissions and access to the selected model, then repeat the request.",
    action: "model",
  },
  "ai-context-limit": {
    title: "AI context limit reached",
    steps:
      "Shorten the conversation or select a model with a larger context window before repeating the request.",
    action: "model",
  },
  "ai-request-format": {
    title: "AI request rejected",
    steps:
      "Change the request or choose a model that supports this operation, then repeat it.",
    action: "model",
  },
  "ai-rate-limit": {
    title: "AI rate limit reached",
    steps:
      "Wait for your provider's rate limit to reset, then repeat the request. Check account limits if it keeps happening.",
    action: null,
  },
  "ai-timeout": {
    title: "AI request timed out",
    steps:
      "Check your connection, then repeat the request. Try a smaller request if it keeps timing out.",
    action: null,
  },
  "ai-provider-unavailable": {
    title: "AI provider unavailable",
    steps:
      "Check your provider's service status and retry when service is restored.",
    action: null,
  },
  "ai-conflict": {
    title: "AI request conflict",
    steps: "Wait for the previous request to finish, then repeat this request.",
    action: null,
  },
  "ai-invalid-response": {
    title: "AI response invalid",
    steps:
      "Repeat the request. If the model keeps returning invalid output, choose another model.",
    action: "model",
  },
} satisfies Record<`ai-${AiErrorType}`, NotificationDefinition>;

const appDefinitions = {
  "pdf-preview": {
    title: "PDF preview unavailable",
    steps:
      "Compile the document again and reopen the PDF preview. If it still cannot be displayed, inspect the build log and check that the PDF file is valid.",
    action: "build-log",
  },
  "pdf-search": {
    title: "PDF search failed",
    steps:
      "Reopen the PDF preview and repeat the search. Compile the document again if the PDF has changed.",
    action: null,
  },
  "chapter-save": {
    title: "Chapter could not be saved",
    steps:
      "Keep the chapter open. Check that the project folder exists, has free space, and is writable, then save again. Closing is canceled while changes remain unsaved.",
    action: null,
  },
  "metadata-save": {
    title: "Project details could not be saved",
    steps:
      "Check free space and write access to the project folder. Repeat the change after correcting access.",
    action: null,
  },
  "recents-save": {
    title: "Recent projects could not be saved",
    steps:
      "Check write access to Aproprose's app configuration folder, then open the project again to update Recent projects.",
    action: null,
  },
  "project-open": {
    title: "Project could not be opened",
    steps:
      "Check that the project folder and main.tex still exist and are readable, then open the project again.",
    action: null,
  },
  "chapter-open": {
    title: "Chapter could not be opened",
    steps:
      "Check that the chapter file exists and is readable in the project folder, then select the chapter again.",
    action: null,
  },
  "project-create": {
    title: "Project could not be created",
    steps:
      "Choose a writable folder with enough free space, then create the project again.",
    action: null,
  },
  "chapter-create": {
    title: "Chapter could not be added",
    steps:
      "Check write access and free space in the project folder, then add the chapter again.",
    action: null,
  },
  "chapter-rename": {
    title: "Chapter could not be renamed",
    steps:
      "Check that the chapter file exists and the project folder is writable, then rename it again.",
    action: null,
  },
  "chapter-reorder": {
    title: "Chapters could not be reordered",
    steps:
      "Check write access to the project folder, then reorder the chapters again.",
    action: null,
  },
  "chapter-delete": {
    title: "Chapter could not be deleted",
    steps:
      "Check write access to the project folder, then delete the chapter again if you still want to remove it.",
    action: null,
  },
  "project-settings": {
    title: "Project settings could not be saved",
    steps:
      "Check write access to the project folder, then save the project settings again.",
    action: null,
  },
  migration: {
    title: "Project migration failed",
    steps:
      "Keep the original project files. Check read and write access to the project folder, then reopen it and retry migration.",
    action: null,
  },
  build: {
    title: "PDF build failed",
    steps:
      "Open the build log, correct the reported document errors, and compile again. If the compiler could not start, check the installed LaTeX tools.",
    action: "build-log",
  },
  "backup-setup": {
    title: "Backup setup failed",
    steps:
      "Check that git and the GitHub CLI are installed, run gh auth login, and choose an available repository name before creating the backup again.",
    action: "backup",
  },
  "backup-status": {
    title: "Backup status unavailable",
    steps:
      "Check that the project folder is accessible and git is installed, then check backup status again.",
    action: "backup",
  },
  "backup-sync": {
    title: "Backup sync failed",
    steps:
      "Check the project's Git remote, connection, and GitHub login, then use Sync now again.",
    action: "backup",
  },
  "backup-auth": {
    title: "GitHub login required",
    steps:
      "Run gh auth login with access to this project's repository, then use Sync now.",
    action: "backup",
  },
  "backup-offline": {
    title: "GitHub could not be reached",
    steps:
      "Check your internet connection and GitHub service status, then use Sync now.",
    action: "backup",
  },
  "backup-conflict": {
    title: "Backup merge conflict",
    steps:
      "Resolve the conflicted files in git, then use Sync now. Auto-sync is paused until you enable it again in Backup settings.",
    action: "backup",
  },
  "backup-rejected": {
    title: "Backup push rejected",
    steps:
      "The remote has newer changes. Use Sync now to reconcile them, then resolve any reported conflicts.",
    action: "backup",
  },
  "backup-diff": {
    title: "Backup changes could not be loaded",
    steps:
      "Check that the project and changed file still exist, then reopen Review changes.",
    action: "backup",
  },
  "candidate-decision": {
    title: "Character review could not be saved",
    steps:
      "Check project write access, then reopen Review characters and repeat the decision.",
    action: null,
  },
  update: {
    title: "App update failed",
    steps:
      "Save your changes, check your connection and free space, then check for updates again in About settings.",
    action: null,
  },
  clipboard: {
    title: "Clipboard unavailable",
    steps:
      "Select the content and try copying again. Check system clipboard access if copying continues to fail.",
    action: null,
  },
  "proposal-context": {
    title: "Proposal context unavailable",
    steps:
      "Open the proposal's project and chapter, then select its context again. Ask the AI to regenerate it if the source has changed.",
    action: null,
  },
  "proposal-stale": {
    title: "Proposal source changed",
    steps:
      "Keep this proposal open and ask the AI to regenerate it against the current source before accepting it.",
    action: null,
  },
  "proposal-apply": {
    title: "Proposal could not be applied",
    steps:
      "Keep the proposal open and ask the AI to regenerate it against the current source before accepting it.",
    action: null,
  },
  "proposal-undo": {
    title: "Outline change could not be undone",
    steps:
      "The outline has changed since the proposal was applied. Review the current outline and edit the affected cards directly.",
    action: null,
  },
  "conversation-load": {
    title: "Conversation could not be loaded",
    steps:
      "Check access to the project folder and retry loading the conversation. Keep the existing conversation files.",
    action: null,
  },
  "conversation-save": {
    title: "Conversation could not be saved",
    steps:
      "Keep the app open. Check free space and project write access, then use the conversation's Retry save action.",
    action: null,
  },
  "conversation-corrupt": {
    title: "Conversation needs recovery",
    steps:
      "Keep the existing conversation file. Restore a known good copy from backup before reloading, or use the conversation recovery action.",
    action: null,
  },
} satisfies Record<string, NotificationDefinition>;

export type AppNotificationType = keyof typeof appDefinitions;
export const NOTIFICATION_DEFINITIONS = { ...aiDefinitions, ...appDefinitions };
export type NotificationType = keyof typeof NOTIFICATION_DEFINITIONS;
export const notificationSchema = z.object({
  id: z.string(),
  type: z.custom<NotificationType>(
    (value) =>
      typeof value === "string" &&
      Object.hasOwn(NOTIFICATION_DEFINITIONS, value),
  ),
  source: z.string(),
  projectRoot: z.string().nullable(),
  provider: z.enum(["openai", "openrouter"]).nullable(),
  firstAt: z.number().finite(),
  lastAt: z.number().finite(),
  occurrences: z.number().int().positive(),
  resolvedAt: z.number().finite().nullable(),
});
export type AppNotification = z.infer<typeof notificationSchema>;
export type NotificationInput = Pick<
  AppNotification,
  "type" | "source" | "projectRoot" | "provider"
>;

export function notificationKey(input: NotificationInput): string {
  return JSON.stringify([
    input.type,
    input.source,
    input.projectRoot,
    input.provider,
  ]);
}
