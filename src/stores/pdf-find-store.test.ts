import { beforeEach, describe, expect, it } from "vitest";
import { usePdfFindStore } from "@/stores/pdf-find-store";

beforeEach(() => {
  usePdfFindStore.getState().reset();
});

describe("PDF find state", () => {
  it("resets match-derived state when the query changes", () => {
    usePdfFindStore.getState().setResult({
      status: "found",
      current: 2,
      total: 5,
      error: null,
    });
    usePdfFindStore.getState().setQuery("Chapter Seven");
    expect(usePdfFindStore.getState()).toMatchObject({
      query: "Chapter Seven",
      status: "idle",
      current: 0,
      total: 0,
      error: null,
    });
  });

  it("retains query and options when a document reload clears results", () => {
    usePdfFindStore.getState().setQuery("arrival");
    usePdfFindStore.getState().toggleCase();
    usePdfFindStore.getState().resetMatches();
    expect(usePdfFindStore.getState()).toMatchObject({
      query: "arrival",
      caseSensitive: true,
      status: "idle",
      current: 0,
      total: 0,
    });
  });

  it("stores explicit search errors", () => {
    usePdfFindStore.getState().setError("Text extraction failed");
    expect(usePdfFindStore.getState()).toMatchObject({
      status: "error",
      error: "Text extraction failed",
      current: 0,
      total: 0,
    });
  });
});
