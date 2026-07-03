import { describe, expect, it } from "vitest";
import { renderGrounding } from "@/lib/ai/grounding-render";

describe("renderGrounding", () => {
  it("renders every section in the canonical order, joined by blank lines", () => {
    const text = renderGrounding({
      chapterTitle: "The Gate",
      characters: [{ name: "Mara", role: "PI" }, { name: "Finch" }],
      cursorSummary: "Cursor sits at the end.",
      structure: "Act I",
      prose: "First.\n\nSecond.",
      instruction: { label: "AUTHOR'S REQUEST (follow this)", text: "tighten it" },
    });
    expect(text).toBe(
      [
        "CHAPTER: The Gate",
        "KNOWN CAST:\n- Mara (PI)\n- Finch",
        "CURSOR: Cursor sits at the end.",
        "STORY STRUCTURE:\nAct I",
        "SCENE PROSE:\nFirst.\n\nSecond.",
        "AUTHOR'S REQUEST (follow this):\ntighten it",
      ].join("\n\n"),
    );
  });

  it("renders id-labeled blocks under the caller's label", () => {
    const text = renderGrounding({
      blocks: {
        label: "SCENE BLOCKS (cite these ids in blockIds)",
        items: [
          { id: "b1", type: "narration", text: "One." },
          { id: "b2", type: "dialogue", text: "Two." },
        ],
      },
    });
    expect(text).toBe(
      "SCENE BLOCKS (cite these ids in blockIds):\n[b1] (narration): One.\n\n[b2] (dialogue): Two.",
    );
  });

  it("skips absent sections, empty casts, and blank instructions but keeps empty prose", () => {
    expect(renderGrounding({ prose: "" })).toBe("SCENE PROSE:\n");
    expect(renderGrounding({ prose: "P", instruction: { label: "L", text: "   " } })).toBe("SCENE PROSE:\nP");
    expect(renderGrounding({ characters: [] })).toBe("");
  });

  it("trims the instruction text", () => {
    expect(renderGrounding({ instruction: { label: "ASK", text: "  do it  " } })).toBe("ASK:\ndo it");
  });
});
