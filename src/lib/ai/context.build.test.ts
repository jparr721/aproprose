import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  compileProject: vi.fn(),
  openProject: vi.fn(),
  pickProjectDir: vi.fn(),
  readAppData: vi.fn().mockResolvedValue(null),
  readPdf: vi.fn().mockRejectedValue(new Error("no pdf")),
  readTextFile: vi.fn(),
  writeAppData: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { buildAiContext } from "@/lib/ai/context";
import { useProjectStore } from "@/stores/project-store";
import type { Block } from "@/lib/types";

const mk = (p: Partial<Block>): Block => ({
  id: "x",
  type: "narration",
  text: "t",
  raw: "",
  dirty: false,
  ...p,
});

beforeEach(() => {
  useProjectStore.setState({
    project: null,
    activeChapterId: null,
    selectedId: null,
    blocks: [],
  });
});

describe("buildAiContext", () => {
  it("includes a freeform break's own text, not a hardcoded separator", () => {
    useProjectStore.setState({
      blocks: [
        mk({ id: "n1", type: "narration", text: "Before." }),
        mk({ id: "brk", type: "chapter", level: "break", text: "Interlude" }),
      ],
    });
    expect(buildAiContext().blocksText).toBe("Before.\n\nInterlude");
  });

  it("falls back to the canonical separator for an empty break", () => {
    useProjectStore.setState({
      blocks: [mk({ id: "brk", type: "chapter", level: "break", text: "" })],
    });
    expect(buildAiContext().blocksText).toBe("* * *");
  });
});
