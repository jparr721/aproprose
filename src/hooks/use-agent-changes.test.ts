import { beforeEach, describe, expect, it } from "vitest";
import { getAgentChangesSnapshot } from "@/hooks/use-agent-changes";
import type { OverviewPendingProposal } from "@/lib/ai/agent-types";
import { EMPTY_META } from "@/lib/migration";
import type { ProjectInfo } from "@/lib/types";
import {
  agentSessionStore,
  clearCharacterAgentSessions,
  clearOutlineAgentSessions,
  useAgentConsoleStore,
} from "@/stores/agent-console-store";
import { emptyPersistedAgentState } from "@/stores/agent-persistence";
import { useProjectStore } from "@/stores/project-store";

const project: ProjectInfo = {
  root: "/book",
  name: "Book",
  mainFile: "main.tex",
  title: "Book",
  author: "Author",
  metadata: { title: "Book", subtitle: "", author: "Author", publisher: "", isbn: "" },
  chapters: [],
};

function proposal(id: string): OverviewPendingProposal {
  return {
    id,
    kind: "overview",
    projectRoot: project.root,
    chapterId: null,
    summary: id,
    createdAt: "2026-10-07T12:00:00.000Z",
    originatingMessageId: `message-${id}`,
    changes: [],
    overviewChange: { id: `change-${id}`, before: "Before", after: "After", reason: "Develop", sourceFingerprint: "source" },
  };
}

describe("agent Changes aggregate", () => {
  beforeEach(() => {
    clearOutlineAgentSessions();
    clearCharacterAgentSessions();
    useAgentConsoleStore.getState().resetProject();
    useAgentConsoleStore.getState().hydrate(project.root, emptyPersistedAgentState());
    useProjectStore.setState({ project, meta: EMPTY_META });
  });

  it("includes candidate reviews in pending counts and invalidates the cached snapshot", () => {
    const before = getAgentChangesSnapshot();
    useProjectStore.setState((state) => ({ meta: {
      ...state.meta, knowledge: { ...state.meta.knowledge, characterCandidates: [{
        id: "candidate", evidenceFingerprint: "fp", name: "Inez", role: "Watchmaker",
        profile: { appearance: "", mannerisms: "", motivations: "", relationships: "", history: "", voice: "" }, evidence: [],
      }] },
    } }));
    expect(getAgentChangesSnapshot()).not.toBe(before);
    expect(getAgentChangesSnapshot()).toMatchObject({ pendingCount: 1, pendingChangeCount: 1 });
    expect(getAgentChangesSnapshot().records).toHaveLength(0);
    useProjectStore.setState({ project: null });
    expect(getAgentChangesSnapshot()).toMatchObject({ pendingCount: 0, pendingChangeCount: 0 });
  });

  it("counts pending proposal rows across sessions and keeps history visible", () => {
    useAgentConsoleStore.getState().stageProposal(proposal("project-result"), { kind: "legacy" });
    const outline = agentSessionStore({ kind: "outline", chapterId: "chapter-1" });
    outline.getState().hydrate(project.root, emptyPersistedAgentState());
    outline.getState().stageProposal(proposal("outline-result"), { kind: "legacy" });
    expect(getAgentChangesSnapshot().pendingCount).toBe(2);
    outline.getState().decideProposalChanges("outline-result", ["change-outline-result"], { status: "dismissed", decidedAt: "2026-10-07T12:01:00.000Z" });
    const snapshot = getAgentChangesSnapshot();
    expect(snapshot.pendingCount).toBe(1);
    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.records.find((entry) => entry.sessionKey === "outline:chapter-1")?.pendingProposal).toBeNull();
  });

  it("keeps snapshots stable for composer updates and detects paid activity in every scope", () => {
    const snapshot = getAgentChangesSnapshot();
    useAgentConsoleStore.getState().setDraftText("An unsent question");
    expect(getAgentChangesSnapshot()).toBe(snapshot);
    const character = agentSessionStore({ kind: "character", characterId: "mara" });
    character.getState().hydrate(project.root, emptyPersistedAgentState());
    character.getState().beginPreflight();
    expect(getAgentChangesSnapshot()).toMatchObject({ runStatus: "submitted", activeSessionId: { kind: "character", characterId: "mara" } });
  });

  it("hides old project records and activity immediately when project ownership changes", () => {
    useAgentConsoleStore.getState().stageProposal(proposal("old"), { kind: "legacy" });
    useAgentConsoleStore.getState().beginPreflight();
    useProjectStore.setState({ project: { ...project, root: "/another-book" } });
    expect(getAgentChangesSnapshot()).toMatchObject({ records: [], pendingCount: 0, runStatus: "idle", activeSessionId: null });
  });
});
