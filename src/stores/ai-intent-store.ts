// ai-intent-store.ts - typed cross-tab dispatch for the AI panel.
//
// Any surface (finding cards, block toolbar, command palette, agent) can hand
// work to a tab: dispatch parks ONE pending intent and opens the panel on the
// target tab; that tab consumes it exactly once (prefill its composer, set
// scope/selection, focus, optionally auto-run). Ephemeral by design - an
// unconsumed intent is simply replaced by the next dispatch.

import { create } from "zustand";
import { useViewStore } from "@/stores/view-store";
import type { ReadScope } from "@/lib/ai/context";

export type LegacyAssistantTab =
  | "outline"
  | "suggest"
  | "edit"
  | "critique"
  | "brainstorm"
  | "continuity"
  | "muse";

export interface AiIntent {
  tab: LegacyAssistantTab;
  /** Prefill for the tab's composer ask box. */
  instruction?: string;
  /** Blocks the intent targets (Edit selects them via setSelection). */
  blockIds?: string[];
  /** Requested scope; each tab maps it onto its own scope state. */
  scope?: ReadScope | "block";
  /** Submit immediately after prefill instead of waiting for the author. */
  autoRun?: boolean;
}

interface AiIntentState {
  pending: AiIntent | null;
  /** Park an intent and open the shared console. */
  dispatch: (intent: AiIntent) => void;
  /** Return-and-clear pending when it targets `tab`, else null. */
  consume: (tab: LegacyAssistantTab) => AiIntent | null;
}

export const useAiIntentStore = create<AiIntentState>()((set, get) => ({
  pending: null,
  dispatch: (intent) => {
    useViewStore.getState().openAiConsole();
    set({ pending: intent });
  },
  consume: (tab) => {
    const p = get().pending;
    if (!p || p.tab !== tab) return null;
    set({ pending: null });
    return p;
  },
}));

/** Convenience wrapper: useAiIntentStore.getState().dispatch(intent). */
export function dispatchAiIntent(intent: AiIntent): void {
  useAiIntentStore.getState().dispatch(intent);
}
