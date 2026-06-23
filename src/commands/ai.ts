// commands/ai.ts - open the AI panel on a given tab, or focus the Suggest ask box.

import { IconSparkles, IconMessageCircle } from "@tabler/icons-react";
import { useViewStore, type AiTab } from "@/stores/view-store";
import type { Command } from "./types";

const AI_TABS: { tab: AiTab; title: string }[] = [
  { tab: "suggest", title: "AI: Suggest" },
  { tab: "critique", title: "AI: Critique" },
  { tab: "brainstorm", title: "AI: Brainstorm" },
  { tab: "continuity", title: "AI: Continuity" },
  { tab: "cast", title: "AI: Cast" },
];

export const aiCommands: Command[] = [
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
