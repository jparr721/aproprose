import { createRoot } from "react-dom/client";
import { AgentSection } from "@/components/app/agent-console/agent-console";
import type { AgentSessionId, OverviewPendingProposal } from "@/lib/ai/agent-types";
import { agentSessionStore } from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import "@/index.css";

const projectRoot = "/fixture/book";
const proposal: OverviewPendingProposal = {
  id: "plan-1",
  kind: "overview",
  projectRoot,
  chapterId: null,
  summary: "Plan the chapter around the friendship and grief, with one clearly marked flashback and a restrained hook that leaves the mechanism uncertain.",
  createdAt: "2026-10-08T00:00:00.000Z",
  originatingMessageId: "assistant-1",
  changes: [],
  overviewChange: {
    id: "overview-1",
    before: "A reunion",
    after: "A reunion tests an old friendship",
    reason: "Focus the emotional turn",
    sourceFingerprint: "fixture-overview",
  },
};
const surfaces: { name: string; sessionId: AgentSessionId; className: string }[] = [
  { name: "planner", sessionId: { kind: "outline", chapterId: "chapter-1" }, className: "h-[36rem] min-w-0 flex-1" },
  { name: "sidebar", sessionId: { kind: "project" }, className: "h-[36rem] w-80 max-w-full shrink-0" },
];

useProjectStore.setState({
  project: {
    root: projectRoot, name: "Example Book", mainFile: "main.tex", title: null, author: null,
    metadata: { title: "", subtitle: "", author: "", publisher: "", isbn: "" },
    chapters: [],
  },
});
for (const surface of surfaces) {
  agentSessionStore(surface.sessionId).setState({
    requestedProjectRoot: projectRoot,
    activeProjectRoot: projectRoot,
    hydratedProjectRoot: projectRoot,
    pendingProposal: proposal,
  });
}

const host = document.getElementById("root");
if (host === null) throw new Error("Missing agent review card fixture root");

createRoot(host).render(
  <main className="flex min-h-svh flex-col gap-8 p-8 lg:flex-row">
    {surfaces.map((surface) => (
      <div key={surface.name} className={surface.className} data-testid={surface.name}>
        <AgentSection
          ariaLabel={`${surface.name} agent`}
          closeLabel={`Close ${surface.name}`}
          contextLabel="Example Book / Chapter 1"
          emptyDescription="Review the proposed chapter plan below."
          emptyTitle="Chapter investigation"
          onClose={() => undefined}
          placeholder="Answer the editor's question"
          sessionId={surface.sessionId}
          task={null}
          title="Outline Planner"
        />
      </div>
    ))}
  </main>,
);
