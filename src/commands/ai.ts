// commands/ai.ts - open the AI panel on a given tab, or focus the Suggest ask box.

import { IconSparkles, IconMessageCircle, IconListTree } from "@tabler/icons-react";
import { useViewStore, type AiTab } from "@/stores/view-store";
import type { Command } from "./types";

const AI_TABS: { tab: AiTab; title: string }[] = [
  { tab: "suggest", title: "AI: Suggest" },
  { tab: "critique", title: "AI: Critique" },
  { tab: "brainstorm", title: "AI: Brainstorm" },
  { tab: "continuity", title: "AI: Continuity" },
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
    run: () => useViewStore.getState().triggerSuggest(),
  },
  ...AI_TABS.map<Command>(({ tab, title }) => ({
    id: `ai.tab-${tab}`,
    group: "AI",
    title,
    icon: IconMessageCircle,
    run: () => useViewStore.getState().openAiTab(tab),
  })),
];
