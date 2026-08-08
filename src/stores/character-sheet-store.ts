import { create } from "zustand";

export type CharacterSheetView = "manual" | "describe";

interface CharacterSheetState {
  characterId: string | null;
  view: CharacterSheetView;
  open: (characterId: string) => void;
  showManual: () => void;
  showDescribe: () => void;
  close: () => void;
}

export const useCharacterSheetStore = create<CharacterSheetState>((set) => ({
  characterId: null,
  view: "manual",
  open: (characterId) => set({ characterId, view: "manual" }),
  showManual: () => set({ view: "manual" }),
  showDescribe: () => set({ view: "describe" }),
  close: () => set({ characterId: null, view: "manual" }),
}));
