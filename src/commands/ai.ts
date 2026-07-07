// commands/ai.ts - open the AI panel on a given tab, or dispatch an AI intent.

import { IconSparkles, IconMessageCircle, IconListTree, IconWand } from "@tabler/icons-react";
import { useViewStore, type AiTab } from "@/stores/view-store";
import { useProjectStore } from "@/stores/project-store";
import { dispatchAiIntent } from "@/stores/ai-intent-store";
import { PICK_UP_AND_GO_DIRECTIVE, pickUpCursorSuffix } from "@/lib/ai/prompts";
import type { Command } from "./types";

const AI_TABS: { tab: AiTab; title: string }[] = [
  { tab: "suggest", title: "AI: Suggest" },
  { tab: "edit", title: "AI: Edit" },
  { tab: "critique", title: "AI: Critique" },
  { tab: "brainstorm", title: "AI: Brainstorm" },
  { tab: "continuity", title: "AI: Continuity" },
  { tab: "muse", title: "AI: Muse" },
];

export const aiCommands: Command[] = [
  {
    id: "view.outline",
    group: "AI",
    title: "Outline",
    icon: IconListTree,
    keywords: ["structure", "beats", "acts", "story spine"],
    run: () => useViewStore.getState().openAiTab("outline"),
  },
  {
    id: "ai.suggest",
    group: "AI",
    title: "Suggest from context",
    icon: IconSparkles,
    keywords: ["continuation", "spark"],
    run: () => dispatchAiIntent({ tab: "suggest" }),
  },
  {
    id: "ai.pick-up",
    group: "AI",
    title: "AI: Pick up and go",
    icon: IconWand,
    keywords: ["stuck", "writers block", "continue"],
    run: () => {
      // The agent's read_chapter grounding does not carry the selection, so
      // the cursor rides in the directive itself. A nav-only highlight can be
      // restored on chapter load, so only an active edit cursor counts here.
      const { selectedId, editing } = useProjectStore.getState();
      const cursorId = editing ? selectedId : null;
      dispatchAiIntent({
        tab: "muse",
        instruction: PICK_UP_AND_GO_DIRECTIVE + pickUpCursorSuffix(cursorId),
        autoRun: true,
      });
    },
  },
  ...AI_TABS.map<Command>(({ tab, title }) => ({
    id: `ai.tab-${tab}`,
    group: "AI",
    title,
    icon: IconMessageCircle,
    run: () => useViewStore.getState().openAiTab(tab),
  })),
];
