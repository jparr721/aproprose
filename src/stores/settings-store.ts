// settings-store.ts - user preferences: appearance and AI model.
//
// One store, one concern. Persisted to the app config dir via the
// Tauri-backed storage adapter. The ThemeController subscribes to apply the theme
// to <html> and drive the prose-size CSS variable.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_SETTINGS,
  isAiProvider,
  PREFERENCE_MAX_CHARS,
  type AiProvider,
  type Settings,
  type Theme,
} from "@/lib/types";
import { tauriStateStorage } from "@/lib/storage";

export interface SettingsState extends Settings {
  /** Whether persisted settings have been read back from disk yet. */
  hydrated: boolean;
  setTheme: (theme: Theme) => void;
  setProseSize: (proseSize: number) => void;
  setPdfZoom: (pdfZoom: number) => void;
  setAiProvider: (aiProvider: AiProvider) => void;
  setAiModel: (aiModel: string | null) => void;
  setLoreTags: (loreTags: string[]) => void;
  setStyleGuide: (styleGuide: string) => void;
  setEditingRules: (editingRules: string) => void;
  setDailyWordGoal: (dailyWordGoal: number | null) => void;
  reset: () => void;
}

export function mergePersistedSettings(
  persistedState: unknown,
  currentState: SettingsState,
): SettingsState {
  if (persistedState === null || typeof persistedState !== "object") {
    return currentState;
  }
  const { aiProvider, ...migrated } = persistedState as Partial<Settings> & {
    aiProvider?: unknown;
  };
  return {
    ...currentState,
    ...migrated,
    aiProvider: isAiProvider(aiProvider) ? aiProvider : currentState.aiProvider,
    aiModel:
      aiProvider !== undefined && !isAiProvider(aiProvider)
        ? null
        : typeof migrated.aiModel === "string" || migrated.aiModel === null
          ? migrated.aiModel
          : currentState.aiModel,
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      hydrated: false,
      setTheme: (theme) => set({ theme }),
      setProseSize: (proseSize) => set({ proseSize }),
      setPdfZoom: (pdfZoom) => set({ pdfZoom }),
      setAiProvider: (aiProvider) => set({ aiProvider, aiModel: null }),
      setAiModel: (aiModel) => set({ aiModel }),
      setLoreTags: (loreTags) =>
        set({ loreTags: [...new Set(loreTags.map((t) => t.trim()).filter(Boolean))] }),
      setStyleGuide: (styleGuide) => set({ styleGuide: styleGuide.slice(0, PREFERENCE_MAX_CHARS) }),
      setEditingRules: (editingRules) =>
        set({ editingRules: editingRules.slice(0, PREFERENCE_MAX_CHARS) }),
      setDailyWordGoal: (dailyWordGoal) =>
        set({
          // A non-finite goal (NaN/Infinity) would slip past Math.max and persist,
          // poisoning goalPercent - treat it as unset rather than storing garbage.
          dailyWordGoal:
            dailyWordGoal === null || !Number.isFinite(dailyWordGoal)
              ? null
              : Math.max(1, Math.floor(dailyWordGoal)),
        }),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: "settings",
      storage: createJSONStorage(() => tauriStateStorage),
      merge: mergePersistedSettings,
      partialize: ({
        theme,
        proseSize,
        pdfZoom,
        aiProvider,
        aiModel,
        loreTags,
        styleGuide,
        editingRules,
        dailyWordGoal,
      }) => ({
        theme,
        proseSize,
        pdfZoom,
        aiProvider,
        aiModel,
        loreTags,
        styleGuide,
        editingRules,
        dailyWordGoal,
      }),
      onRehydrateStorage: () => (state) => {
        // Mark hydrated once the async read resolves (or fails). Clamp the
        // preferences read from disk to the cap - a legacy or hand-edited
        // settings file can exceed it, and the setters only clamp the live path -
        // so the store never holds more than the UI and prompts use.
        useSettingsStore.setState(
          state
            ? {
                hydrated: true,
                styleGuide: state.styleGuide.slice(0, PREFERENCE_MAX_CHARS),
                editingRules: state.editingRules.slice(0, PREFERENCE_MAX_CHARS),
              }
            : { hydrated: true },
        );
      },
    },
  ),
);
