import type { AgentErrorCode } from "@/lib/ai/agent-types";

const agentErrorText: Record<AgentErrorCode, string> = {
  configuration: "AI is not configured. Open AI Settings to continue.",
  transport:
    "The AI request could not be completed. Check your connection and retry.",
  tool: "A project action could not be completed. Retry the request.",
  compaction:
    "Older conversation context could not be prepared. Retry the request.",
  unknown: "The AI request could not be completed. Retry the request.",
};

export function safeAgentErrorText(
  errorCode: AgentErrorCode | null,
): string {
  return agentErrorText[errorCode ?? "unknown"];
}
