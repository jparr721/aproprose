// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(import("@/lib/tauri"), async (importOriginal) => ({
  ...await importOriginal(),
  readAppData: vi.fn().mockResolvedValue(null),
  readProjectMeta: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
  writeProjectMeta: vi.fn().mockResolvedValue(undefined),
}));

import { ChangesPanel } from "@/components/app/changes-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EMPTY_AGENT_STATE, clearCharacterAgentSessions, clearOutlineAgentSessions, useAgentConsoleStore } from "@/stores/agent-console-store";
import { useViewStore } from "@/stores/view-store";
import type { OverviewPendingProposal } from "@/lib/ai/agent-types";
import { emptyProjectKnowledge } from "@/lib/story-knowledge/model";
import { writeProjectMeta } from "@/lib/tauri";
import type { CharacterCandidate } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const candidate: CharacterCandidate = {
  id: "candidate-inez",
  evidenceFingerprint: "candidate-fp",
  name: "Inez",
  role: "Watchmaker",
  profile: {
    appearance: "Silver hair",
    mannerisms: "Counts exits before sitting",
    motivations: "Protect the city clocks",
    relationships: "",
    history: "",
    voice: "Precise and spare",
  },
  evidence: [
    {
      chapterId: "ch1",
      sourceId: "block-1",
      order: 0,
      fingerprint: "evidence-fp",
      occurrence: 0,
      previewText: "She counts every door twice.",
    },
  ],
};

function renderReview(): ReturnType<typeof render> {
  return render(<TooltipProvider><ChangesPanel /></TooltipProvider>);
}

beforeEach(() => {
  clearCharacterAgentSessions();
  clearOutlineAgentSessions();
  useAgentConsoleStore.setState({ ...EMPTY_AGENT_STATE, requestedProjectRoot: "/book", activeProjectRoot: "/book", hydratedProjectRoot: "/book" });
  useViewStore.setState({ changesOpen: true, aiOpen: false, focus: false, selectedChange: null });
  vi.mocked(writeProjectMeta).mockReset();
  vi.mocked(writeProjectMeta).mockResolvedValue(undefined);
  useProjectStore.setState({
    project: {
      root: "/book",
      name: "Book",
      mainFile: "main.tex",
      title: "Book",
      author: "Author",
      metadata: {
        title: "Book",
        subtitle: "",
        author: "Author",
        publisher: "",
        isbn: "",
      },
      chapters: [
        {
          id: "ch1",
          label: "1",
          title: "First",
          file: "first.tex",
          wordCount: 100,
        },
      ],
    },
    meta: {
      version: 5,
      characters: [
        {
          id: "c-mara",
          name: "Mara",
          role: "Detective",
          color: "#aabbcc",
          profile: {
            appearance: "",
            mannerisms: "",
            motivations: "",
            relationships: "",
            history: "",
            voice: "",
          },
        },
      ],
      lore: [],
      statuses: {},
      outline: { premise: "", overview: "" },
      chapters: {},
      knowledge: {
        ...emptyProjectKnowledge(),
        characterCandidates: [candidate],
      },
    },
  } as never);
});

afterEach(cleanup);

describe("CharacterCandidatesReview", () => {
  for (const phase of ["loaded", "arrives"]) {
    it.each([
      { changesOpen: false, aiOpen: false, focus: false },
      { changesOpen: false, aiOpen: true, focus: false },
      { changesOpen: true, aiOpen: false, focus: true },
    ])(`preserves the workspace when candidates ${phase}: %j`, (layout) => {
      useViewStore.setState(layout);
      if (phase === "arrives") {
        useProjectStore.setState((state) => ({ meta: { ...state.meta, knowledge: { ...state.meta.knowledge, characterCandidates: [] } } }));
      }
      renderReview();
      if (phase === "arrives") {
        act(() => { useProjectStore.setState((state) => ({ meta: { ...state.meta, knowledge: { ...state.meta.knowledge, characterCandidates: [candidate] } } })); });
      }
      expect(useViewStore.getState()).toMatchObject(layout);
      fireEvent.click(screen.getByRole("button", { name: /Review new characters/ }));
      expect(useViewStore.getState()).toMatchObject({ changesOpen: true, aiOpen: false, focus: false });
    });
  }

  for (const navigation of ["history", "revision"]) {
    for (const action of ["accept", "dismiss"]) {
      it.each(["resolve", "reject"] as const)(`retains ${action} save state across ${navigation} navigation until %s`, async (outcome) => {
        const write = deferred<void>();
        vi.mocked(writeProjectMeta).mockReturnValueOnce(write.promise);
        try {
          const rio: CharacterCandidate = { ...candidate, id: "candidate-rio", evidenceFingerprint: "rio-fp", name: "Rio" };
          useProjectStore.setState((state) => ({ meta: { ...state.meta, knowledge: { ...state.meta.knowledge, characterCandidates: [candidate, rio] } } }));
          const overview: OverviewPendingProposal = {
            id: "overview", kind: "overview", projectRoot: "/book", chapterId: null, summary: "Revise overview", createdAt: "2026-10-10T00:00:00.000Z", originatingMessageId: "assistant", changes: [],
            overviewChange: { id: "overview-change", before: "", after: "A clockwork mystery", reason: "Focus the story", sourceFingerprint: "fp" },
          };
          useAgentConsoleStore.getState().stageProposal(overview, { kind: "legacy" });
          useViewStore.getState().selectChange("characters", "/book");
          renderReview();
          fireEvent.click(screen.getByRole("button", { name: action === "accept" ? "Add Inez" : "Dismiss Inez" }));
          if (navigation === "history") {
            fireEvent.click(screen.getByRole("button", { name: "History (0)" }));
            expect(screen.queryByRole("button", { name: "Add Rio" })).toBeNull();
            fireEvent.click(screen.getByRole("button", { name: "Pending drafts (2)" }));
          } else {
            fireEvent.click(screen.getByRole("button", { name: /Revise overview/ }));
            expect(screen.queryByRole("button", { name: "Add Rio" })).toBeNull();
          }
          fireEvent.click(screen.getByRole("button", { name: /Review new characters/ }));
          expect(screen.getByRole("button", { name: "Add Rio" }).hasAttribute("disabled")).toBe(true);
          expect(screen.getByRole("button", { name: "Dismiss Rio" }).hasAttribute("disabled")).toBe(true);
          expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
          fireEvent.click(screen.getByRole("button", { name: "Add Rio" }));
          expect(useProjectStore.getState().meta.knowledge.characterCandidates).toEqual([rio]);
          await act(async () => {
            if (outcome === "resolve") write.resolve(undefined);
            else write.reject(new Error("disk full"));
          });
          await waitFor(() => expect(screen.getByRole("button", { name: "Add Rio" }).hasAttribute("disabled")).toBe(false));
          if (outcome === "reject") {
            expect(screen.getByRole("alert").textContent).toContain("See Settings > Notifications");
            expect(useProjectStore.getState().meta.knowledge.characterCandidates).toEqual([candidate, rio]);
            expect(useProjectStore.getState().meta.characters).toHaveLength(1);
            fireEvent.click(screen.getByRole("button", { name: "Add Rio" }));
            await waitFor(() => expect(screen.queryByRole("button", { name: "Add Rio" })).toBeNull());
            const saved: unknown = JSON.parse(vi.mocked(writeProjectMeta).mock.calls[1][1]);
            expect(saved).toMatchObject({ characters: [{ name: "Mara" }, { name: "Rio" }], knowledge: { characterCandidates: [candidate] } });
          } else {
            expect(screen.queryByRole("alert")).toBeNull();
            expect(useProjectStore.getState().meta.characters).toHaveLength(action === "accept" ? 2 : 1);
          }
        } finally {
          await act(async () => write.resolve(undefined));
        }
      });
    }
  }

  it("shows generated details and evidence before accepting", async () => {
    renderReview();

    expect(screen.getByText("Inez")).toBeTruthy();
    expect(screen.getByText("Watchmaker")).toBeTruthy();
    expect(screen.getByText("Counts exits before sitting")).toBeTruthy();
    expect(screen.getByText("She counts every door twice.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Inez" }));

    await waitFor(() => {
      expect(useProjectStore.getState().meta.characters).toHaveLength(2);
    });
    expect(
      useProjectStore.getState().meta.knowledge.characterCandidates,
    ).toEqual([]);
  });

  it("dismisses a candidate without creating a character", async () => {
    renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Inez" }));

    await waitFor(() => {
      expect(
        useProjectStore.getState().meta.knowledge.characterCandidates,
      ).toEqual([]);
    });
    expect(useProjectStore.getState().meta.characters).toHaveLength(1);
  });

  it("keeps candidate actions pending until metadata is persisted", async () => {
    const write = deferred<void>();
    vi.mocked(writeProjectMeta).mockReturnValueOnce(write.promise);
    renderReview();

    fireEvent.click(screen.getByRole("button", { name: "Add Inez" }));

    const addButton = await screen.findByRole("button", { name: /Add Inez/ });
    const dismissButton = screen.getByRole("button", { name: "Dismiss Inez" });
    expect((addButton as HTMLButtonElement).disabled).toBe(true);
    expect((dismissButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();

    write.resolve(undefined);
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Add Inez/ }),
      ).toBeNull();
    });
  });

  it("shows persistence errors and restores a failed candidate action", async () => {
    vi.mocked(writeProjectMeta).mockRejectedValueOnce(new Error("disk full"));
    renderReview();

    fireEvent.click(screen.getByRole("button", { name: "Add Inez" }));

    expect((await screen.findByRole("alert")).textContent).toContain("See Settings > Notifications");
    expect(
      useProjectStore.getState().meta.knowledge.characterCandidates,
    ).toEqual([candidate]);
    expect(
      (screen.getByRole("button", { name: "Add Inez" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("renders every pending candidate", () => {
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        knowledge: {
          ...state.meta.knowledge,
          characterCandidates: [
            candidate,
            { ...candidate, id: "candidate-rio", name: "Rio" },
          ],
        },
      },
    }));

    renderReview();

    expect(
      screen.getByRole("button", { name: "Add Rio" }),
    ).toBeTruthy();
  });
});
