// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoryRefreshStatus } from "@/components/app/outline/story-refresh-status";
import { emptyProjectKnowledge } from "@/lib/story-knowledge/model";
import type { ChapterKnowledge } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";
import { useStoryRefreshStore } from "@/stores/story-refresh-store";

const chapterKnowledge = (sourceFingerprint: string): ChapterKnowledge => ({
  sourceFingerprint,
  summary: "",
  premiseSignals: [],
  conflictSignals: [],
  stakeSignals: [],
  arcSignals: [],
  endingSignals: [],
  characterObservations: [],
  unknownCharacterObservations: [],
});

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
        {
          id: "ch2",
          label: "2",
          title: "Second",
          file: "second.tex",
          wordCount: 100,
        },
      ],
    },
    meta: {
      version: 5,
      characters: [],
      lore: [],
      statuses: {},
      outline: { premise: "", overview: "" },
      chapters: {},
      knowledge: emptyProjectKnowledge(),
    },
  } as never);
  useStoryRefreshStore.setState({
    status: "idle",
    progress: { completedChapters: 0, totalChapters: 0 },
    error: null,
    pendingFingerprints: {},
    latestSavedFingerprints: {},
  });
});

afterEach(() => cleanup());

describe("StoryRefreshStatus", () => {
  it("shows spinner progress while refreshing without an ellipsis", () => {
    useStoryRefreshStore.setState({
      status: "refreshing",
      progress: { completedChapters: 1, totalChapters: 3 },
      error: null,
    });

    render(<StoryRefreshStatus />);

    const label = screen.getByText("Refreshing 1 of 3 chapters");
    expect(label.textContent).not.toContain("...");
    expect(label.textContent).not.toContain("\u2026");
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("shows an actionable retry after failure", () => {
    const retry = vi.fn();
    useStoryRefreshStore.setState({
      status: "failed",
      error: "HTTP 429 - rate limited",
      retry,
    });

    render(<StoryRefreshStatus />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("alert").textContent).toContain(
      "HTTP 429 - rate limited",
    );
    expect(retry).toHaveBeenCalledOnce();
  });

  it("reports when no current chapter has been refreshed", () => {
    render(<StoryRefreshStatus />);

    expect(screen.getByText("Not refreshed")).toBeTruthy();
  });

  it("reports current coverage and ignores removed chapters", () => {
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        knowledge: {
          ...state.meta.knowledge,
          chapters: {
            ch1: chapterKnowledge("fp-1"),
            removed: chapterKnowledge("old-fp"),
          },
        },
      },
    }));

    render(<StoryRefreshStatus />);

    expect(screen.getByText("1 of 2 chapters refreshed")).toBeTruthy();
  });

  it("reports up to date only when persisted knowledge matches latest saves", () => {
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        knowledge: {
          ...state.meta.knowledge,
          chapters: {
            ch1: chapterKnowledge("fp-1"),
            ch2: chapterKnowledge("fp-2"),
          },
        },
      },
    }));
    useStoryRefreshStore.setState({
      latestSavedFingerprints: { ch1: "fp-1", ch2: "fp-new" },
    });

    const { rerender } = render(<StoryRefreshStatus />);
    expect(screen.getByText("1 of 2 chapters refreshed")).toBeTruthy();

    useStoryRefreshStore.setState({
      latestSavedFingerprints: { ch1: "fp-1", ch2: "fp-2" },
    });
    rerender(<StoryRefreshStatus />);

    expect(screen.getByText("Up to date")).toBeTruthy();
  });

  it("shows the number of character candidates", () => {
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        knowledge: {
          ...state.meta.knowledge,
          characterCandidates: [
            {
              id: "candidate-inez",
              evidenceFingerprint: "candidate-fp",
              name: "Inez",
              role: "Watchmaker",
              profile: {
                appearance: "",
                mannerisms: "",
                motivations: "",
                relationships: "",
                history: "",
                voice: "",
              },
              evidence: [],
            },
          ],
        },
      },
    }));

    render(<StoryRefreshStatus />);

    expect(
      screen.getByRole("button", { name: "Review 1 character" }),
    ).toBeTruthy();
  });
});
