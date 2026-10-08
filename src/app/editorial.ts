import { Editorial } from "@/editorial";
import { submitAgentRequest } from "@/lib/ai/agent-controller";
import { agentConsoleOwnershipStatus, agentSessionStore } from "@/stores/agent-console-store";
import { hydrateAgentOutlineSession } from "@/stores/agent-persistence";
import { useProjectStore } from "@/stores/project-store";

export const editorial = new Editorial({
  hydrate: hydrateAgentOutlineSession,
  read: (chapterId) => agentSessionStore({ kind: "outline", chapterId }).getState(),
  ownsProject: (projectRoot) => useProjectStore.getState().project?.root === projectRoot,
  isReady: (state, projectRoot) => agentConsoleOwnershipStatus(state, projectRoot) === "ready",
  start: (chapterId) => submitAgentRequest({
    kind: "run",
    mode: "edit",
    task: { kind: "outline-sculpt", chapterId },
    refs: [],
    text: "Investigate the existing chapter and planning cards now. Read the complete chapter, preserve my saved writing and editing preferences, identify the most consequential weaknesses or contradictions, and ask the first focused question needed to improve it. Retrieve other book material only when a concrete uncertainty calls for it. Do not invent my intentions or treat suggestions as my decisions.",
  }, { kind: "outline", chapterId }),
});
