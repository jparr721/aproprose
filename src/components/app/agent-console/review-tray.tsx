import { IconArrowRight, IconFileDiff } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TypographyMuted } from "@/components/ui/typography";
import { agentSessionKey, PROJECT_AGENT_SESSION, type AgentSessionId } from "@/lib/ai/agent-types";
import { useAgentSessionStore } from "@/stores/agent-console-store";
import { useViewStore } from "@/stores/view-store";

export function ReviewTray({ sessionId: requestedSessionId }: { sessionId?: AgentSessionId }) {
  const sessionId = requestedSessionId ?? PROJECT_AGENT_SESSION;
  const proposal = useAgentSessionStore(sessionId, (state) => state.pendingProposal);
  if (proposal === null) return null;
  const count = proposal.changes.length + (proposal.overviewChange ? 1 : 0);
  return (
    <Card data-agent-review-tray size="sm" className="shrink-0">
      <CardHeader>
        <CardTitle>{proposal.summary}</CardTitle>
        <TypographyMuted>{count} {count === 1 ? "change" : "changes"} ready for review</TypographyMuted>
      </CardHeader>
      <CardContent>
        <Button
          onClick={() => useViewStore.getState().selectChange(agentSessionKey(sessionId), proposal.id)}
          size="sm"
          variant="outline"
        >
          <IconFileDiff />Review changes<IconArrowRight />
        </Button>
      </CardContent>
    </Card>
  );
}
