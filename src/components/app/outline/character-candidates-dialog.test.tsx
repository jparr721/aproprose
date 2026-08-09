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
import type { CharacterCandidate } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";

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
