// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPersistenceIssue } from "@/lib/ai/agent-types";

const decisions = vi.hoisted(() => ({ applyAll: vi.fn(), applyOne: vi.fn(), dismiss: vi.fn(), navigate: vi.fn().mockResolvedValue(true), source: vi.fn().mockResolvedValue(true), stale: new Set<string>(), sourceRequired: false }));
vi.mock("@/lib/storage", () => ({ tauriStateStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined } }));
vi.mock("@/lib/ai/agent-controller", () => ({ stopAgentRun: vi.fn() }));
vi.mock("@/lib/ai/agent-navigation", () => ({ navigateToProposalChange: decisions.navigate, navigateToProposalSource: decisions.source }));
vi.mock("@/lib/ai/proposal-decisions", () => ({ acceptAllProposalChanges: decisions.applyAll, acceptProposalChange: decisions.applyOne, rejectAllProposalChanges: decisions.dismiss, proposalStaleChangeIds: () => decisions.stale, proposalRequiresSourceNavigation: () => decisions.sourceRequired }));
vi.mock("@/components/app/agent-console/agent-console", () => ({ AgentPersistenceBanner: ({ subject, issue }: { subject: string; issue: AgentPersistenceIssue }) => <div role="alert">{subject} could not be {issue.kind === "save" ? "saved" : "loaded"}.</div> }));

import { ChangesPanel } from "@/components/app/changes-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgentProposalRecord, ManuscriptPendingProposal, OutlinePendingProposal } from "@/lib/ai/agent-types";
import { EMPTY_META } from "@/lib/migration";
import { applyProposal } from "@/lib/blocks/proposal";
import type { ProjectInfo } from "@/lib/types";
import { EMPTY_AGENT_STATE, clearOutlineAgentSessions, useAgentConsoleStore } from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

const project: ProjectInfo = {
  root: "/book", name: "Book", mainFile: "main.tex", title: "Book", author: "Author",
  metadata: { title: "Book", subtitle: "", author: "Author", publisher: "", isbn: "" },
  chapters: [{ id: "ch1", label: "1", title: "The Crossing", file: "one.tex", wordCount: 10 }],
};

function proposal(id: string): ManuscriptPendingProposal {
  return {
    id, kind: "manuscript", projectRoot: "/book", chapterId: "ch1", summary: `Revise ${id}`, createdAt: "2026-10-08T00:00:00.000Z", originatingMessageId: "assistant-1",
    changes: ["first", "second"].map((part) => ({
      id: `${id}-${part}`,
      change: { kind: "rewrite", blockId: part, afterId: null, type: null, speaker: null, newText: `Proposed ${part}`, toIndex: null, reason: "Tighten the prose" },
      precondition: { kind: "target", target: { sourceId: part, order: 0, fingerprint: "source-fingerprint", sourceType: "narration", label: "Narration", exactText: `Before ${part}`, previewText: `Full source ${part}` } },
    })),
  };
}

function record(value: ManuscriptPendingProposal): AgentProposalRecord {
  return { proposal: value, source: { kind: "legacy" }, decisions: {}, replacedByProposalId: null };
}

function renderPanel(): ReturnType<typeof render> {
  return render(<TooltipProvider><ChangesPanel /></TooltipProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  decisions.stale = new Set();
  decisions.sourceRequired = false;
  clearOutlineAgentSessions();
  useProjectStore.setState({ project, activeChapterId: "ch1", meta: EMPTY_META, blocks: [], chapterDirty: false });
  useViewStore.setState({ aiOpen: false, changesOpen: true, selectedChange: null });
  useAgentConsoleStore.setState({ ...EMPTY_AGENT_STATE, requestedProjectRoot: "/book", activeProjectRoot: "/book", hydratedProjectRoot: "/book" });
  useAgentConsoleStore.getState().stageProposal(proposal("one"), { kind: "legacy" });
});
afterEach(cleanup);

describe("ChangesPanel", () => {
  it("reviews generated characters beside existing revisions without opening a dialog", () => {
    useProjectStore.setState((state) => ({ meta: {
      ...state.meta, knowledge: { ...state.meta.knowledge, characterCandidates: [{
        id: "candidate-inez", evidenceFingerprint: "fp", name: "Inez", role: "Watchmaker",
        profile: { appearance: "Silver hair", mannerisms: "Counts exits", motivations: "", relationships: "", history: "", voice: "" },
        evidence: [{ chapterId: "ch1", sourceId: "b1", order: 0, fingerprint: "e1", occurrence: 0, previewText: "She counts every door twice." }],
      }] },
    } }));
    renderPanel();
    expect(screen.getByRole("button", { name: "Pending drafts (2)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Review new characters/ }));
    expect(screen.getByText("Silver hair")).toBeTruthy();
    expect(screen.getByText("She counts every door twice.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Inez" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Revise one/ }));
    expect(screen.getByText("Proposed first")).toBeTruthy();
  });

  it("does not keep a previous project's character review selected", () => {
    useViewStore.getState().selectChange("characters", "/another-book");
    renderPanel();
    expect(screen.getByText("Proposed first")).toBeTruthy();
    expect(screen.queryByText("No pending characters")).toBeNull();
  });

  it("shows proposal rows, frozen context, top batch Apply and trash without duplicate panel chrome", () => {
    const { container } = renderPanel();
    const panel = screen.getByRole("region", { name: "Changes" });
    expect(within(panel).getByRole("button", { name: "Pending drafts (1)" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Apply 2" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Dismiss draft" })).toBeTruthy();
    expect(within(panel).getByText("Full source first")).toBeTruthy();
    expect(within(panel).getByText("Proposed first")).toBeTruthy();
    expect(container.querySelector("header")).toBeNull();
    expect(within(panel).queryByText("Draft saved")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Apply 2" }));
    expect(decisions.applyAll).toHaveBeenCalledWith(expect.objectContaining({ id: "one", changes: expect.arrayContaining([expect.objectContaining({ id: "one-first" }), expect.objectContaining({ id: "one-second" })]) }), { kind: "project" });
  });

  it("captures the selected draft's exact pending subset in dismiss confirmation", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss draft" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("Dismiss 2 pending changes?");
    act(() => useAgentConsoleStore.getState().stageProposal(proposal("two"), { kind: "legacy" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Dismiss" }));
    expect(decisions.dismiss).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }), { kind: "project" });
    expect(useAgentConsoleStore.getState().proposalRecords).toHaveLength(2);
  });

  it("keeps partially decided content inspectable and restores only dismissed changes", () => {
    const mixed = record(proposal("mixed"));
    mixed.decisions = {
      "mixed-first": { status: "applied", decidedAt: "2026-10-08T01:00:00.000Z" },
      "mixed-second": { status: "dismissed", decidedAt: "2026-10-08T01:01:00.000Z" },
    };
    useAgentConsoleStore.setState({ proposalRecords: [mixed], currentProposalId: "mixed", pendingProposal: null });
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "History (1)" }));
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(screen.getByText("Dismissed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore to pending" }));
    const saved = useAgentConsoleStore.getState().proposalRecords[0];
    expect(saved.decisions["mixed-first"].status).toBe("applied");
    expect(saved.decisions["mixed-second"]).toBeUndefined();
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
    expect(container.querySelectorAll("[data-agent-change-id]")).toHaveLength(2);
  });

  it("requires explicit source navigation without mislabeling an inactive chapter stale", () => {
    decisions.sourceRequired = true;
    renderPanel();
    expect(screen.getByRole("button", { name: "Apply 2" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Source changed")).toBeNull();
    const alert = screen.getByText("Open the source chapter").closest('[role="alert"]');
    if (!(alert instanceof HTMLElement)) throw new Error("Missing source navigation alert");
    fireEvent.click(within(alert).getByRole("button", { name: "Go to source" }));
    expect(decisions.source).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
  });

  it("preserves stale previews and keeps dismissal available", () => {
    decisions.stale = new Set(["one-first"]);
    renderPanel();
    expect(screen.getByText("Full source first")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply 2" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Dismiss draft" }).hasAttribute("disabled")).toBe(false);
  });

  it("passes the owning project with an individual source navigation request", () => {
    const { container } = renderPanel();
    const change = container.querySelector('[data-agent-change-id="one-first"]');
    if (!(change instanceof HTMLElement)) throw new Error("Missing proposed change");
    fireEvent.click(within(change).getByRole("button", { name: "Go to source" }));
    expect(decisions.navigate).toHaveBeenCalledWith("/book", "ch1", proposal("one").changes[0]);
  });

  it("shows a retained dialogue tail through opening edits and applied history without duplicating it", () => {
    const dialogue: ManuscriptPendingProposal = {
      id: "dialogue", kind: "manuscript", projectRoot: "/book", chapterId: "ch1", summary: "Continue the conversation", createdAt: "2026-10-08T01:00:00.000Z", originatingMessageId: "assistant-dialogue",
      changes: [{
        id: "dialogue-insert",
        change: { kind: "insert", blockId: null, afterId: null, type: "dialogue", speaker: "Mara", newText: "Wait.", segments: [{ kind: "beat", text: "She lifted the lantern." }, { kind: "quote", text: "Follow me." }], toIndex: null, reason: "Carry the conversation forward" },
        precondition: { kind: "insert", boundary: "immediate", anchor: null, expectedNext: null },
      }],
    };
    useAgentConsoleStore.getState().stageProposal(dialogue, { kind: "legacy" });
    useViewStore.getState().selectChange("project", dialogue.id);
    const { container } = renderPanel();
    const change = container.querySelector('[data-agent-change-id="dialogue-insert"]');
    if (!(change instanceof HTMLElement)) throw new Error("Missing dialogue insert");
    expect(change.textContent).toContain("Wait.");
    expect(change.textContent).toContain("She lifted the lantern.");
    expect(change.textContent).toContain("Follow me.");
    fireEvent.keyDown(within(change).getByRole("button", { name: "Change actions" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit draft" }));
    const textbox = screen.getByRole("textbox", { name: "Edit proposed text" });
    if (!(textbox instanceof HTMLTextAreaElement)) throw new Error("Missing opening-text editor");
    expect(textbox.value).toBe("Wait.");
    expect(change.textContent).toContain("She lifted the lantern.");
    expect(change.textContent).toContain("Follow me.");
    fireEvent.change(textbox, { target: { value: "Come here." } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    const saved = useAgentConsoleStore.getState().proposalRecords.find((entry) => entry.proposal.id === dialogue.id)?.proposal;
    if (saved === undefined || saved.kind !== "manuscript") throw new Error("Missing retained dialogue proposal");
    expect(saved.changes[0].change.newText).toBe("Come here.");
    expect(saved.changes[0].change.segments).toEqual([{ kind: "beat", text: "She lifted the lantern." }, { kind: "quote", text: "Follow me." }]);
    const applied = applyProposal([], [saved.changes[0].change], () => undefined);
    expect(applied.blocks).toHaveLength(1);
    expect(applied.blocks[0]).toMatchObject({ text: "Come here.", tail: [{ kind: "beat", text: "She lifted the lantern." }, { kind: "quote", text: "Follow me." }] });
    act(() => { useAgentConsoleStore.getState().decideProposalChanges(dialogue.id, ["dialogue-insert"], { status: "applied", decidedAt: "2026-10-08T02:00:00.000Z" }); });
    fireEvent.click(screen.getByRole("button", { name: "History (1)" }));
    expect(screen.getByText("Applied")).toBeTruthy();
    const history = container.querySelector('[data-agent-change-id="dialogue-insert"]');
    if (!(history instanceof HTMLElement)) throw new Error("Missing dialogue history");
    expect(history.textContent).toContain("Come here.");
    expect(history.textContent).toContain("She lifted the lantern.");
    expect(history.textContent).toContain("Follow me.");
    expect(within(history).queryByRole("button", { name: "Change actions" })).toBeNull();
  });

  it("edits the exact pending change while keeping the frozen source intact", () => {
    const { container } = renderPanel();
    const change = container.querySelector('[data-agent-change-id="one-first"]');
    if (!(change instanceof HTMLElement)) throw new Error("Missing proposed change");
    fireEvent.keyDown(within(change).getByRole("button", { name: "Change actions" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit draft" }));
    expect(screen.getByRole("button", { name: "Apply 2" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Edit proposed text" }), { target: { value: "The author's revised draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    const saved = useAgentConsoleStore.getState().proposalRecords[0].proposal;
    if (saved.kind !== "manuscript") throw new Error("Expected manuscript proposal");
    expect(saved.changes[0].change.newText).toBe("The author's revised draft");
    expect(saved.changes[0].precondition).toEqual(proposal("one").changes[0].precondition);
    expect(screen.getByText("The author's revised draft")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Edit proposed text" })).toBeNull();
  });

  it("routes individual Apply and Dismiss to one change without expanding the batch", () => {
    const { container } = renderPanel();
    const change = container.querySelector('[data-agent-change-id="one-first"]');
    if (!(change instanceof HTMLElement)) throw new Error("Missing proposed change");
    fireEvent.keyDown(within(change).getByRole("button", { name: "Change actions" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Apply change" }));
    expect(decisions.applyOne).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }), "one-first", { kind: "project" });
    fireEvent.keyDown(within(change).getByRole("button", { name: "Change actions" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Dismiss change" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("Dismiss 1 pending change?");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Dismiss" }));
    const selected = decisions.dismiss.mock.calls[0][0];
    expect(selected.id).toBe("one");
    expect(selected.changes).toHaveLength(1);
    expect(selected.changes[0].id).toBe("one-first");
  });

  it("switches a manuscript rewrite between readable prose and exact target differences", () => {
    const { container } = renderPanel();
    expect(container.querySelector("ins")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show differences" }));
    expect(container.querySelector("ins")?.textContent).toContain("Proposed");
    expect(container.querySelector("del")?.textContent).toContain("Before");
    expect(screen.getByText("Full source first")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read prose" }));
    expect(container.querySelector("ins")).toBeNull();
    expect(screen.getByText("Proposed first")).toBeTruthy();
  });

  it("shows frozen outline and attached overview differences without duplicate decision trays", () => {
    const outline: OutlinePendingProposal = {
      id: "outline", kind: "outline", chapterId: "ch1", projectRoot: "/book", summary: "Shape the outline", createdAt: "2026-10-08T01:00:00.000Z", originatingMessageId: "assistant-2",
      changes: [{ id: "outline-change", change: { kind: "rewrite", cardId: "card-1", title: "New title", intention: null, toIndex: null, reason: "Focus the beat" }, precondition: { kind: "card", target: { sourceId: "card-1", order: 0, fingerprint: "card-fingerprint", sourceType: "outline-card", label: "Old title", exactText: "Old title\nOld stakes", previewText: "Old title\nOld stakes" } } }],
      overviewChange: { id: "overview-change", before: "Old story", after: "New story", reason: "Focus the story", sourceFingerprint: "overview-fingerprint" },
    };
    useAgentConsoleStore.getState().stageProposal(outline, { kind: "legacy" });
    useViewStore.getState().selectChange("project", "outline");
    const { container } = renderPanel();
    expect(screen.getByText("Story overview - before")).toBeTruthy();
    expect(screen.getByText("New story")).toBeTruthy();
    expect(container.textContent).toContain("Old stakes");
    fireEvent.click(screen.getByRole("button", { name: "Show differences" }));
    expect(container.querySelectorAll("ins")).toHaveLength(2);
    expect(container.querySelectorAll("del")).toHaveLength(2);
    expect(container.querySelector("[data-agent-review-tray]")).toBeNull();
  });

  it("does not report caught up when storage is unavailable", () => {
    useAgentConsoleStore.setState({ proposalRecords: [], pendingProposal: null, currentProposalId: null, hydratedProjectRoot: null, persistenceIssue: { kind: "corrupt", projectRoot: "/book", message: "Stored data is corrupt" } });
    renderPanel();
    expect(screen.getByRole("alert").textContent).toContain("Changes could not be loaded");
    expect(screen.getByText("Changes unavailable")).toBeTruthy();
    expect(screen.queryByText("All caught up")).toBeNull();
  });

  it("shows submitted activity before response text without hiding existing drafts", () => {
    useAgentConsoleStore.setState({ runStatus: "submitted" });
    const { container } = renderPanel();
    expect(screen.getByText("Preparing draft")).toBeTruthy();
    expect(screen.getByText("Proposed first")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply 2" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(container.querySelector('[data-slot="spinner"]')?.getAttribute("class")).toContain("motion-reduce:animate-none");
  });

  it("links a failed Suggest to retained AI output and returns close focus to the toggle", () => {
    useAgentConsoleStore.setState({ runError: { reason: "tool", message: "No reviewable continuation was staged.", action: null, settingsTarget: null } });
    const toggle = document.createElement("button");
    toggle.setAttribute("data-changes-toggle", "");
    document.body.append(toggle);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "View AI output" }));
    expect(useViewStore.getState()).toMatchObject({ aiOpen: true, changesOpen: false });
    const close = screen.getByRole("button", { name: "Close Changes" });
    close.focus();
    fireEvent.click(close);
    expect(document.activeElement).toBe(toggle);
    toggle.remove();
  });
});
