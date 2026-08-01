// commands/ai.ts - typed entry points into the persistent AI console.

import {
  IconLink,
  IconListCheck,
  IconMessageCircle,
  IconPencil,
  IconSparkles,
  IconWand,
} from "@tabler/icons-react";
import { dispatchAgentIntent } from "@/lib/ai/agent-controller";
import { findBridgeSuccessor } from "@/lib/ai/agent-context";
import {
  CONTINUITY_DIRECTIVE,
  CRITIQUE_DIRECTIVE,
  PICK_UP_DIRECTIVE,
  SUGGEST_DIRECTIVE,
} from "@/lib/ai/agent-prompts";
import type { DraftContextRef } from "@/lib/ai/agent-types";
import {
  selectionTargetIds,
  useProjectStore,
} from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import type { Command } from "./types";

function blockRefs(chapterId: string, blockIds: string[]): DraftContextRef[] {
  return blockIds.map((blockId) => ({ kind: "block", chapterId, blockId }));
}

function selectedBlockRefs(
  chapterId: string,
  selectedIds: string[],
  selectedId: string | null,
): DraftContextRef[] {
  return blockRefs(chapterId, selectionTargetIds(selectedIds, selectedId));
}

function hasActiveChapter(): boolean {
  return useProjectStore.getState().activeChapterId !== null;
}

function hasSelectedProse(): boolean {
  const state = useProjectStore.getState();
  if (state.activeChapterId === null || state.selectedId === null) return false;
  const selected = state.blocks.find((block) => block.id === state.selectedId);
  return (
    selected !== undefined &&
    (selected.type === "narration" || selected.type === "dialogue")
  );
}

function runSuggest(): void {
  const state = useProjectStore.getState();
  const chapterId = state.activeChapterId;
  if (chapterId === null) return;
  void dispatchAgentIntent({
    kind: "run",
    mode: "writing",
    text: SUGGEST_DIRECTIVE,
    refs: selectedBlockRefs(chapterId, state.selectedIds, state.selectedId),
    task: { kind: "conversation", targetChapterId: chapterId },
  });
}

function runPickUp(): void {
  const state = useProjectStore.getState();
  const chapterId = state.activeChapterId;
  const anchorBlockId = state.selectedId;
  if (chapterId === null || anchorBlockId === null) return;
  const anchor = state.blocks.find((block) => block.id === anchorBlockId);
  if (
    anchor === undefined ||
    (anchor.type !== "narration" && anchor.type !== "dialogue")
  ) {
    return;
  }
  void dispatchAgentIntent({
    kind: "run",
    mode: "writing",
    text: PICK_UP_DIRECTIVE,
    refs: blockRefs(chapterId, [anchorBlockId]),
    task: {
      kind: "bridge",
      chapterId,
      anchorBlockId,
      successorBlockId: findBridgeSuccessor(state.blocks, anchorBlockId),
    },
  });
}

function runCritique(): void {
  const state = useProjectStore.getState();
  const chapterId = state.activeChapterId;
  if (chapterId === null) return;
  void dispatchAgentIntent({
    kind: "run",
    mode: "edit",
    text: CRITIQUE_DIRECTIVE,
    refs: selectedBlockRefs(chapterId, state.selectedIds, state.selectedId),
    task: {
      kind: "chapter-analysis",
      chapterId,
      analysis: "critique",
    },
  });
}

function runContinuity(): void {
  const state = useProjectStore.getState();
  const chapterId = state.activeChapterId;
  if (chapterId === null) return;
  void dispatchAgentIntent({
    kind: "run",
    mode: "edit",
    text: CONTINUITY_DIRECTIVE,
    refs: selectedBlockRefs(chapterId, state.selectedIds, state.selectedId),
    task: {
      kind: "chapter-analysis",
      chapterId,
      analysis: "continuity",
    },
  });
}

export const aiCommands: Command[] = [
  {
    id: "ai.open",
    group: "AI",
    title: "Open AI Console",
    icon: IconMessageCircle,
    keywords: ["assistant", "conversation"],
    run: () => useViewStore.getState().openAiConsole(),
  },
  {
    id: "ai.mode-writing",
    group: "AI",
    title: "Use Writing Mode",
    icon: IconPencil,
    keywords: ["continue", "draft"],
    run: () => {
      void dispatchAgentIntent({ kind: "focus", mode: "writing" });
    },
  },
  {
    id: "ai.mode-edit",
    group: "AI",
    title: "Use Edit Mode",
    icon: IconPencil,
    keywords: ["revise", "review"],
    run: () => {
      void dispatchAgentIntent({ kind: "focus", mode: "edit" });
    },
  },
  {
    id: "ai.suggest",
    group: "AI",
    title: "Suggest From Context",
    icon: IconSparkles,
    keywords: ["continuation", "spark"],
    enabled: hasActiveChapter,
    run: runSuggest,
  },
  {
    id: "ai.pick-up",
    group: "AI",
    title: "Pick Up From Here",
    icon: IconWand,
    keywords: ["stuck", "writers block", "continue"],
    enabled: hasSelectedProse,
    run: runPickUp,
  },
  {
    id: "ai.critique",
    group: "AI",
    title: "Critique Chapter",
    icon: IconListCheck,
    keywords: ["craft", "review"],
    enabled: hasActiveChapter,
    run: runCritique,
  },
  {
    id: "ai.continuity",
    group: "AI",
    title: "Check Continuity",
    icon: IconLink,
    keywords: ["consistency", "timeline"],
    enabled: hasActiveChapter,
    run: runContinuity,
  },
];
