import { create } from "zustand";

export type SearchSurface = "editor" | "pdf";

interface SearchSurfaceState {
  activeSurface: SearchSurface;
  openSurface: SearchSurface | null;
  focusRevision: number;
  activate: (surface: SearchSurface) => void;
  openActive: () => void;
  close: (surface: SearchSurface) => void;
  removePdf: () => void;
}

export const useSearchSurfaceStore = create<SearchSurfaceState>((set, get) => ({
  activeSurface: "editor",
  openSurface: null,
  focusRevision: 0,
  activate: (activeSurface) => set({ activeSurface }),
  openActive: () =>
    set((state) => ({
      openSurface: state.activeSurface,
      focusRevision: state.focusRevision + 1,
    })),
  close: (surface) => {
    if (get().openSurface === surface) set({ openSurface: null });
  },
  removePdf: () =>
    set((state) => ({
      activeSurface:
        state.activeSurface === "pdf" ? "editor" : state.activeSurface,
      openSurface: state.openSurface === "pdf" ? null : state.openSurface,
    })),
}));
