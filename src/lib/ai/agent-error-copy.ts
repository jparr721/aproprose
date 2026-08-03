import type { AgentFailure } from "@/lib/ai/agent-types";

export function safeAgentErrorText(failure: AgentFailure): string {
  return failure.message;
}
