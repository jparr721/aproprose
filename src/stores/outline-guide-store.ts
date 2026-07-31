import { create } from "zustand";
import type { ChatMessage, GuidedOutlineSession } from "@/lib/types";

interface OutlineGuideState {
  sessions: Record<string, GuidedOutlineSession>;
  running: Record<string, boolean>;
  errors: Record<string, string>;
  activeTurnIds: Record<string, number>;
  nextTurnId: number;
  startTurn: (chapterId: string, messages: ChatMessage[]) => number;
  finishTurn: (chapterId: string, turnId: number, session: GuidedOutlineSession) => void;
  failTurn: (chapterId: string, turnId: number, error: string) => void;
  hydrate: (sessions: Record<string, GuidedOutlineSession>) => void;
  reset: () => void;
}

export const useOutlineGuideStore = create<OutlineGuideState>((set) => ({
  sessions: {},
  running: {},
  errors: {},
  activeTurnIds: {},
  nextTurnId: 0,
  startTurn: (chapterId, messages) => {
    let turnId = 0;
    set((state) => {
      turnId = state.nextTurnId + 1;
      const errors = { ...state.errors };
      delete errors[chapterId];
      return {
        sessions: {
          ...state.sessions,
          [chapterId]: {
            messages,
            plan: state.sessions[chapterId]?.plan ?? null,
          },
        },
        running: { ...state.running, [chapterId]: true },
        activeTurnIds: { ...state.activeTurnIds, [chapterId]: turnId },
        nextTurnId: turnId,
        errors,
      };
    });
    return turnId;
  },
  finishTurn: (chapterId, turnId, session) =>
    set((state) => {
      if (state.activeTurnIds[chapterId] !== turnId) return state;
      const running = { ...state.running };
      const errors = { ...state.errors };
      const activeTurnIds = { ...state.activeTurnIds };
      delete running[chapterId];
      delete errors[chapterId];
      delete activeTurnIds[chapterId];
      return {
        sessions: { ...state.sessions, [chapterId]: session },
        running,
        errors,
        activeTurnIds,
      };
    }),
  failTurn: (chapterId, turnId, error) =>
    set((state) => {
      if (state.activeTurnIds[chapterId] !== turnId) return state;
      const running = { ...state.running };
      const activeTurnIds = { ...state.activeTurnIds };
      delete running[chapterId];
      delete activeTurnIds[chapterId];
      return {
        running,
        activeTurnIds,
        errors: { ...state.errors, [chapterId]: error },
      };
    }),
  hydrate: (sessions) => set({ sessions, running: {}, errors: {}, activeTurnIds: {} }),
  reset: () => set({ sessions: {}, running: {}, errors: {}, activeTurnIds: {} }),
}));
