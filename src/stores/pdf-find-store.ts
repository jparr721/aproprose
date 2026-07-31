import { create } from "zustand";
import {
  EMPTY_PDF_FIND_RESULT,
  type PdfFindQuery,
  type PdfFindResult,
} from "@/lib/pdf/find";

interface PdfFindState extends PdfFindQuery, PdfFindResult {
  setQuery: (query: string) => void;
  toggleCase: () => void;
  toggleWholeWord: () => void;
  setPending: () => void;
  setResult: (result: PdfFindResult) => void;
  setError: (message: string) => void;
  resetMatches: () => void;
  reset: () => void;
}

const initialState: PdfFindQuery & PdfFindResult = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  status: EMPTY_PDF_FIND_RESULT.status,
  current: EMPTY_PDF_FIND_RESULT.current,
  total: EMPTY_PDF_FIND_RESULT.total,
  error: EMPTY_PDF_FIND_RESULT.error,
};

export const usePdfFindStore = create<PdfFindState>((set) => ({
  query: initialState.query,
  caseSensitive: initialState.caseSensitive,
  wholeWord: initialState.wholeWord,
  status: initialState.status,
  current: initialState.current,
  total: initialState.total,
  error: initialState.error,
  setQuery: (query) =>
    set({
      query,
      status: "idle",
      current: 0,
      total: 0,
      error: null,
    }),
  toggleCase: () =>
    set((state) => ({
      caseSensitive: !state.caseSensitive,
      status: "idle",
      current: 0,
      total: 0,
      error: null,
    })),
  toggleWholeWord: () =>
    set((state) => ({
      wholeWord: !state.wholeWord,
      status: "idle",
      current: 0,
      total: 0,
      error: null,
    })),
  setPending: () => set({ status: "pending", error: null }),
  setResult: (result) => set(result),
  setError: (error) =>
    set({
      status: "error",
      current: 0,
      total: 0,
      error,
    }),
  resetMatches: () => set(EMPTY_PDF_FIND_RESULT),
  reset: () => set(initialState),
}));
