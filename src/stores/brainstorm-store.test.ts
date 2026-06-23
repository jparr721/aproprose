import { describe, it, expect, beforeEach } from "vitest";
import { useBrainstormStore } from "@/stores/brainstorm-store";
import type { ChatMessage } from "@/lib/types";

const msg = (role: ChatMessage["role"], content: string): ChatMessage => ({ role, content });

beforeEach(() => useBrainstormStore.setState({ threads: {} }));

describe("brainstorm-store", () => {
  it("setThread stores a chapter's messages", () => {
    useBrainstormStore.getState().setThread("ch1", [msg("user", "hi")]);
    expect(useBrainstormStore.getState().threads.ch1).toEqual([{ role: "user", content: "hi" }]);
  });

  it("setThread is per-chapter and leaves others untouched", () => {
    useBrainstormStore.getState().setThread("ch1", [msg("user", "a")]);
    useBrainstormStore.getState().setThread("ch2", [msg("user", "b")]);
    expect(useBrainstormStore.getState().threads.ch1).toEqual([{ role: "user", content: "a" }]);
    expect(useBrainstormStore.getState().threads.ch2).toEqual([{ role: "user", content: "b" }]);
  });

  it("hydrate replaces all threads", () => {
    useBrainstormStore.getState().setThread("stale", [msg("user", "x")]);
    useBrainstormStore.getState().hydrate({ ch1: [msg("assistant", "y")] });
    expect(useBrainstormStore.getState().threads.stale).toBeUndefined();
    expect(useBrainstormStore.getState().threads.ch1).toEqual([{ role: "assistant", content: "y" }]);
  });

  it("reset clears all threads", () => {
    useBrainstormStore.getState().setThread("ch1", [msg("user", "x")]);
    useBrainstormStore.getState().reset();
    expect(useBrainstormStore.getState().threads).toEqual({});
  });
});
