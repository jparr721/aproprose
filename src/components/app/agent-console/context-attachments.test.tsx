// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DraftContextAttachments,
  SentContextAttachments,
} from "@/components/app/agent-console/context-attachments";
import { draftContextRefKey } from "@/lib/ai/agent-context";
import type {
  ContextSnapshot,
  DraftContextRef,
  DraftContextSource,
} from "@/lib/ai/agent-types";

const narrationRef: DraftContextRef = {
  kind: "block",
  chapterId: "ch1",
  blockId: "block-1",
};

const outlineRef: DraftContextRef = {
  kind: "outline-card",
  chapterId: "ch1",
  cardId: "card-1",
};

const narrationSource: DraftContextSource = {
  ref: narrationRef,
  available: true,
  label: "Narration block",
  preview: "The rain crossed the window.",
  resolved: {
    kind: "block",
    chapterId: "ch1",
    sourceId: "block-1",
    order: 0,
    sourceType: "narration",
    label: "Narration block",
    exactText: "The rain crossed the window.",
    sourceFingerprint: "fingerprint-1",
  },
};

const outlineSource: DraftContextSource = {
  ref: outlineRef,
  available: true,
  label: "The door opens",
  preview: "Force Mara to choose.",
  resolved: {
    kind: "outline-card",
    chapterId: "ch1",
    sourceId: "card-1",
    order: 1,
    sourceType: "outline-card",
    label: "The door opens",
    exactText: "The door opens\nForce Mara to choose.",
    sourceFingerprint: "fingerprint-2",
  },
};

const sources: Record<string, DraftContextSource> = {
  [draftContextRefKey(narrationRef)]: narrationSource,
  [draftContextRefKey(outlineRef)]: outlineSource,
};

const sentSnapshot: ContextSnapshot = {
  id: "snapshot-1",
  kind: "block",
  chapterId: "ch1",
  sourceId: "block-1",
  order: 0,
  sourceType: "narration",
  label: "Narration block",
  exactText: "The rain crossed the window.",
  sourceFingerprint: "fingerprint-1",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DraftContextAttachments", () => {
  it("renders one removable inline attachment for each draft reference", () => {
    render(
      <DraftContextAttachments
        refs={[narrationRef, outlineRef]}
        sources={sources}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText("Narration block")).toBeTruthy();
    expect(screen.getByText("The door opens")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(2);
  });

  it("removes only the selected draft attachment without submitting its form", () => {
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });

    function DraftHarness() {
      const [refs, setRefs] = useState<DraftContextRef[]>([
        narrationRef,
        outlineRef,
      ]);
      return (
        <form onSubmit={onSubmit}>
          <DraftContextAttachments
            refs={refs}
            sources={sources}
            onRemove={(removed) => {
              const removedKey = draftContextRefKey(removed);
              setRefs((current) =>
                current.filter(
                  (candidate) => draftContextRefKey(candidate) !== removedKey,
                ),
              );
            }}
          />
        </form>
      );
    }

    render(<DraftHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Narration block" }));

    expect(screen.queryByText("Narration block")).toBeNull();
    expect(screen.getByText("The door opens")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders duplicate draft references once", () => {
    render(
      <DraftContextAttachments
        refs={[narrationRef, { ...narrationRef }]}
        sources={sources}
        onRemove={vi.fn()}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: "Remove Narration block" }),
    ).toHaveLength(1);
  });

  it("keeps an unavailable draft source visible, previewable, and removable", async () => {
    const onRemove = vi.fn();
    const unavailable: DraftContextSource = {
      ref: narrationRef,
      available: false,
      label: "Narration block",
      preview: "",
      resolved: null,
    };

    render(
      <DraftContextAttachments
        refs={[narrationRef]}
        sources={{ [draftContextRefKey(narrationRef)]: unavailable }}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText("Unavailable")).toBeTruthy();
    fireEvent.pointerEnter(screen.getByRole("group", { name: "Narration block context" }));
    await waitFor(() =>
      expect(screen.getAllByText("Unavailable")).toHaveLength(2),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Narration block" }));
    expect(onRemove).toHaveBeenCalledWith(narrationRef);
  });
});

describe("SentContextAttachments", () => {
  it("previews the frozen sent text after the live source changes", async () => {
    let liveText = sentSnapshot.exactText;
    const frozenSnapshot = { ...sentSnapshot, exactText: liveText };
    liveText = "The sun crossed the window.";

    render(
      <SentContextAttachments
        snapshots={[frozenSnapshot]}
        onNavigate={vi.fn().mockResolvedValue(true)}
      />,
    );
    fireEvent.pointerEnter(
      screen.getByRole("button", { name: "Open Narration block context" }),
    );

    expect(await screen.findByText("The rain crossed the window.")).toBeTruthy();
    expect(screen.queryByText(liveText)).toBeNull();
  });

  it("navigates from a sent attachment when its live source is available", async () => {
    const onNavigate = vi.fn().mockResolvedValue(true);
    render(
      <SentContextAttachments
        snapshots={[sentSnapshot]}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open Narration block context" }),
    );

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(sentSnapshot));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the saved exact text when a sent source is unavailable", async () => {
    render(
      <SentContextAttachments
        snapshots={[sentSnapshot]}
        onNavigate={vi.fn().mockResolvedValue(false)}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open Narration block context" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Narration block");
    expect(dialog.textContent).toContain("The rain crossed the window.");
    expect(dialog.textContent).toContain("Unavailable");
  });
});
