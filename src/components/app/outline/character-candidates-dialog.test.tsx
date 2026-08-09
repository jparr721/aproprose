// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readAppData: vi.fn().mockResolvedValue(null),
  readProjectMeta: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
  writeProjectMeta: vi.fn().mockResolvedValue(undefined),
}));

import { CharacterCandidatesDialog } from "@/components/app/outline/character-candidates-dialog";
import { emptyProjectKnowledge } from "@/lib/story-knowledge/model";
import { writeProjectMeta } from "@/lib/tauri";
import type { CharacterCandidate } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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

beforeEach(() => {
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

afterEach(() => cleanup());

describe("CharacterCandidatesDialog", () => {
  it("shows generated details and evidence before accepting", async () => {
    render(<CharacterCandidatesDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Review 1 character" }));

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
    render(<CharacterCandidatesDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Review 1 character" }));
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
    render(<CharacterCandidatesDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Review 1 character" }));

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
    render(<CharacterCandidatesDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Review 1 character" }));

    fireEvent.click(screen.getByRole("button", { name: "Add Inez" }));

    expect((await screen.findByRole("alert")).textContent).toContain("disk full");
    expect(
      useProjectStore.getState().meta.knowledge.characterCandidates,
    ).toEqual([candidate]);
    expect(
      (screen.getByRole("button", { name: "Add Inez" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("pluralizes the candidate count", () => {
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

    render(<CharacterCandidatesDialog />);

    expect(
      screen.getByRole("button", { name: "Review 2 characters" }),
    ).toBeTruthy();
  });
});
