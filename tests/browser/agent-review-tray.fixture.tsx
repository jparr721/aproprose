import { createRoot } from "react-dom/client";
import { AgentSection } from "@/components/app/agent-console/agent-console";
import { ChangesPanel } from "@/components/app/changes-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { blockFingerprint, outlineOrderFingerprint, storyOverviewFingerprint } from "@/lib/ai/agent-context";
import type { AgentSessionId, ManuscriptPendingProposal, OutlinePendingProposal, OverviewPendingProposal } from "@/lib/ai/agent-types";
import type { Block, CharacterCandidate } from "@/lib/types";
import { agentSessionStore } from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import "@/index.css";

const projectRoot = "/fixture/book";
const proposal: OutlinePendingProposal = {
  id: "plan-1",
  kind: "outline",
  projectRoot,
  chapterId: "chapter-1",
  summary: "Plan the chapter around the friendship and grief, with one clearly marked flashback and a restrained hook that leaves the mechanism uncertain.",
  createdAt: "2026-10-08T03:00:00.000Z",
  originatingMessageId: "assistant-1",
  changes: [{
    id: "planning-change",
    change: { kind: "add", cardId: null, title: "Anchor the reunion", intention: "Keep the present-day reunion as the main scene and make the emotional turn clear.", toIndex: null, reason: "Focus the chapter" },
    precondition: { kind: "outline-order", orderFingerprint: outlineOrderFingerprint([]) },
  }],
};
const sourceBlock: Block = {
  id: "source-block", type: "narration", text: "They met after sunset.", raw: "They met after sunset.", dirty: false,
};
const manuscript: ManuscriptPendingProposal = {
  id: "manuscript-1", kind: "manuscript", projectRoot, chapterId: "chapter-1",
  summary: "Review manuscript prose", createdAt: "2026-10-08T02:00:00.000Z", originatingMessageId: "assistant-2",
  changes: [{
    id: "manuscript-change",
    change: { kind: "rewrite", blockId: sourceBlock.id, afterId: null, type: null, speaker: null, newText: "They met beneath the station clock after sunset.", toIndex: null, reason: "Ground the reunion" },
    precondition: { kind: "target", target: { sourceId: sourceBlock.id, order: 0, fingerprint: blockFingerprint(sourceBlock), sourceType: "narration", label: "Narration", exactText: sourceBlock.text, previewText: sourceBlock.text } },
  }],
};
const overview: OverviewPendingProposal = {
  id: "overview-1", kind: "overview", projectRoot, chapterId: null,
  summary: "Review story overview", createdAt: "2026-10-08T01:00:00.000Z", originatingMessageId: "assistant-3", changes: [],
  overviewChange: {
    id: "overview-change",
    before: "",
    after: "A reunion tests an old friendship",
    reason: "Focus the emotional turn",
    sourceFingerprint: storyOverviewFingerprint(""),
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
    chapters: [{ id: "chapter-1", label: "1", title: "The Reunion", file: "reunion.tex", wordCount: 5 }],
  },
  activeChapterId: "chapter-1",
  blocks: [sourceBlock],
});
for (const surface of surfaces) {
  agentSessionStore(surface.sessionId).setState({
    requestedProjectRoot: projectRoot,
    activeProjectRoot: projectRoot,
    hydratedProjectRoot: projectRoot,
  });
}
const projectSession = agentSessionStore({ kind: "project" });
projectSession.getState().stageProposal(overview, { kind: "legacy" });
projectSession.getState().stageProposal(manuscript, { kind: "legacy" });
for (const surface of surfaces) {
  agentSessionStore(surface.sessionId).getState().stageProposal({ ...proposal, id: `plan-${surface.name}` }, { kind: "legacy" });
}
useViewStore.getState().selectChange("project", "plan-sidebar");

const characterReview = new URLSearchParams(window.location.search).has("characters");
if (characterReview) {
  const candidates: CharacterCandidate[] = ["Two unidentified men", "Raul Pizano", "Unnamed bagel-counter woman"].map((name, index) => ({
    id: `candidate-${index}`, name, role: "Generated from manuscript evidence", evidenceFingerprint: `candidate-fp-${index}`,
    profile: {
      appearance: "Their faces are angular and hard. They arrive in a black SUV and inspect the house window by window.",
      mannerisms: "They patiently inspect the house, manipulate the deadbolt without forcing entry, leave an item in the door, and do not call out.",
      motivations: "Their surveillance suggests deliberate interest in the house, but the evidence does not establish why.",
      relationships: "They appear connected to the card left by the detective, but their identities remain unknown.",
      history: "The visitors have returned several times in the recent chapters.", voice: "Quiet and deliberate",
    },
    evidence: [{ chapterId: "chapter-1", sourceId: sourceBlock.id, order: index, fingerprint: `evidence-${index}`, occurrence: 0, previewText: "The men studied each window before leaving a card in the door." }],
  }));
  useProjectStore.setState((state) => ({ meta: { ...state.meta, knowledge: { ...state.meta.knowledge, characterCandidates: candidates } } }));
  useViewStore.getState().selectChange("characters", projectRoot);
}

const host = document.getElementById("root");
if (host === null) throw new Error("Missing agent review card fixture root");

createRoot(host).render(
  <TooltipProvider>
    {characterReview ? <main className="h-svh w-80 max-w-full" data-testid="characters"><ChangesPanel /></main> : <main className="flex min-h-svh flex-col gap-8 p-8 lg:flex-row [--prose-size:28px]">
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
      <div className="h-[36rem] w-80 max-w-full shrink-0" data-testid="changes">
        <ChangesPanel />
      </div>
    </main>}
  </TooltipProvider>,
);
