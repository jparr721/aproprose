// settings-store.ts - user preferences: appearance, layout, and AI provider/model.
//
// One store, one concern (per CLAUDE.md). Persisted to the app config dir via the
// Tauri-backed storage adapter. The ThemeController subscribes to apply the theme
// to <html> and drive the prose-size CSS variable.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_SETTINGS,
  type AiProvider,
  type BlockStyle,
  type LayoutMode,
  type Settings,
  type Theme,
} from "@/lib/types";
import { tauriStateStorage } from "@/lib/storage";

interface SettingsState extends Settings {
  /** Whether persisted settings have been read back from disk yet. */
  hydrated: boolean;
  setTheme: (theme: Theme) => void;
  setLayout: (layout: LayoutMode) => void;
  setBlockStyle: (blockStyle: BlockStyle) => void;
  setProseSize: (proseSize: number) => void;
  setPdfZoom: (pdfZoom: number) => void;
  setAiModel: (aiModel: string | null) => void;
  setAiProvider: (aiProvider: AiProvider) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      hydrated: false,
      setTheme: (theme) => set({ theme }),
      setLayout: (layout) => set({ layout }),
      setBlockStyle: (blockStyle) => set({ blockStyle }),
      setProseSize: (proseSize) => set({ proseSize }),
      setPdfZoom: (pdfZoom) => set({ pdfZoom }),
      setAiModel: (aiModel) => set({ aiModel }),
      setAiProvider: (aiProvider) => set({ aiProvider }),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: "settings",
      storage: createJSONStorage(() => tauriStateStorage),
      partialize: ({ theme, layout, blockStyle, proseSize, pdfZoom, aiModel, aiProvider }) => ({
        theme,
        layout,
        blockStyle,
        proseSize,
        pdfZoom,
        aiModel,
        aiProvider,
      }),
      onRehydrateStorage: () => (state) => {
        // Mark hydrated once the async read resolves (or fails).
        useSettingsStore.setState({ hydrated: true });
        void state;
      },
    },
  ),
);
