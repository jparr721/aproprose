// find-store.ts - in-chapter find & replace UI + match state.
//
// A store (not editor-local state) because the find widget WRITES the query /
// current match while each `Block` READS the current match to highlight it - two
// unrelated components sharing read+write state. The pure matcher lives in
// `lib/blocks/find.ts`; this layer derives matches from the project store's blocks
// and routes replacements back through it (one undo step each). It is also the
// seam a later whole-book find reuses.

import { create } from "zustand";
import { useProjectStore } from "@/stores/project-store";
import {
  findMatches,
  replaceAllEdits,
  replaceOne,
  type FindOptions,
  type Match,
} from "@/lib/blocks/find";

interface FindState {
  open: boolean;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Whether the Replace row is revealed. */
  replaceExpanded: boolean;
  matches: Match[];
  /** Index into `matches`, or -1 when there are none. */
  currentIndex: number;
  /** Invalid-regex message, or null. */
  error: string | null;
  /** Bumped to focus + select the query input (the widget consumes it). */
  focusTick: number;

  openFind: () => void;
  openReplace: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  setReplacement: (replacement: string) => void;
  toggleCase: () => void;
  toggleWord: () => void;
  toggleRegex: () => void;
  toggleReplace: () => void;
  /** Re-derive matches from the live blocks; clamps the current index. */
  recompute: () => void;
  next: () => void;
  prev: () => void;
  replaceCurrent: () => void;
  replaceAll: () => void;
}

const optionsOf = (s: FindState): FindOptions => ({
  caseSensitive: s.caseSensitive,
  wholeWord: s.wholeWord,
  regex: s.regex,
});

function scrollMatchIntoView(match: Match | undefined): void {
  if (!match) return;
  document
    .querySelector(`[data-block-id="${match.blockId}"]`)
    ?.scrollIntoView({ block: "center" });
}

export const useFindStore = create<FindState>((set, get) => ({
  open: false,
  query: "",
  replacement: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  replaceExpanded: false,
  matches: [],
  currentIndex: -1,
  error: null,
  focusTick: 0,

  openFind: () => set((s) => ({ open: true, focusTick: s.focusTick + 1 })),
  openReplace: () =>
    set((s) => ({ open: true, replaceExpanded: true, focusTick: s.focusTick + 1 })),
  // Keep query / replacement / options for the next open; just drop live matches.
  close: () => set({ open: false, matches: [], currentIndex: -1, error: null }),

  setQuery: (query) => set({ query }),
  setReplacement: (replacement) => set({ replacement }),
  toggleCase: () => set((s) => ({ caseSensitive: !s.caseSensitive })),
  toggleWord: () => set((s) => ({ wholeWord: !s.wholeWord })),
  toggleRegex: () => set((s) => ({ regex: !s.regex })),
  toggleReplace: () => set((s) => ({ replaceExpanded: !s.replaceExpanded })),

  recompute: () => {
    const s = get();
    const blocks = useProjectStore.getState().blocks;
    const { matches, error } = findMatches(blocks, s.query, optionsOf(s));
    // Keep the user on the same match across edits when it still exists; else
    // clamp the prior index into range (0 when there was none).
    const prev = s.matches[s.currentIndex];
    let currentIndex = -1;
    if (matches.length > 0) {
      const kept = prev
        ? matches.findIndex((m) => m.blockId === prev.blockId && m.start === prev.start)
        : -1;
      currentIndex =
        kept >= 0 ? kept : Math.min(Math.max(s.currentIndex, 0), matches.length - 1);
    }
    set({ matches, error, currentIndex });
    scrollMatchIntoView(matches[currentIndex]);
  },

  next: () => {
    const s = get();
    if (s.matches.length === 0) return;
    const currentIndex = (s.currentIndex + 1) % s.matches.length;
    set({ currentIndex });
    scrollMatchIntoView(s.matches[currentIndex]);
  },

  prev: () => {
    const s = get();
    const n = s.matches.length;
    if (n === 0) return;
    const currentIndex = (s.currentIndex - 1 + n) % n;
    set({ currentIndex });
    scrollMatchIntoView(s.matches[currentIndex]);
  },

  replaceCurrent: () => {
    const s = get();
    const match = s.matches[s.currentIndex];
    if (!match) return;
    const block = useProjectStore.getState().blocks.find((b) => b.id === match.blockId);
    if (!block) return;
    const text = replaceOne(block.text, match, s.query, s.replacement, optionsOf(s));
    useProjectStore.getState().formatBlockText(match.blockId, text);
    // Re-find against the new blocks and advance to the first match at/after the
    // replacement's end - so a replacement that itself contains the query (find
    // "cat", replace "cats") isn't immediately re-hit. Wraps to the first match.
    const blocks = useProjectStore.getState().blocks;
    const { matches, error } = findMatches(blocks, s.query, optionsOf(s));
    const order = new Map(blocks.map((b, i) => [b.id, i]));
    const fromBlock = order.get(match.blockId) ?? 0;
    const fromOffset = match.start + s.replacement.length;
    let currentIndex = matches.findIndex((m) => {
      const mb = order.get(m.blockId) ?? 0;
      return mb > fromBlock || (mb === fromBlock && m.start >= fromOffset);
    });
    if (currentIndex < 0 && matches.length > 0) currentIndex = 0;
    set({ matches, error, currentIndex });
    scrollMatchIntoView(matches[currentIndex]);
  },

  replaceAll: () => {
    const s = get();
    const blocks = useProjectStore.getState().blocks;
    const edits = replaceAllEdits(blocks, s.query, s.replacement, optionsOf(s));
    if (edits.length === 0) return;
    useProjectStore.getState().applyBlockEdits(edits);
    get().recompute();
  },
}));
