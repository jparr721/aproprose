// changelog-store.ts - open state for the "What's New" dialog plus the optional
// incoming-version notes. Written from the update toast (See changes), the settings
// entry, and the macOS menu - unrelated components - so it is a store, not local state.

import { create } from "zustand";
import type { IncomingNotes } from "@/lib/changelog";

export interface IncomingVersion {
  readonly version: string;
  readonly notes: IncomingNotes;
}

interface ChangelogState {
  isOpen: boolean;
  incoming: IncomingVersion | null;
  open: (incoming: IncomingVersion | null) => void;
  close: () => void;
}

export const useChangelogStore = create<ChangelogState>((set) => ({
  isOpen: false,
  incoming: null,
  open: (incoming) => set({ isOpen: true, incoming }),
  close: () => set({ isOpen: false }),
}));
