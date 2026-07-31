import { beforeEach, describe, expect, it } from "vitest";
import { buildGuidedOutlineContext } from "@/lib/ai/guided-outline-context";
import { useProjectStore } from "@/stores/project-store";

beforeEach(() => {
  useProjectStore.setState({
    project: {
      root: "/novel",
      name: "Northbound",
      mainFile: "main.tex",
      title: "Northbound",
      author: "A. Writer",
      metadata: {
        title: "Northbound",
        subtitle: "",
        author: "A. Writer",
        publisher: "",
        isbn: "",
      },
      chapters: [
        {
          id: "ch1",
          label: "I",
          title: "The Winter Letter",
          file: "content/ch1.tex",
          wordCount: 42,
        },
      ],
    },
    activeChapterId: "ch1",
    blocks: [
      {
        id: "b1",
        type: "narration",
        text: "Snow gathered on the unopened letter.",
        raw: "",
        dirty: false,
      },
      {
        id: "b2",
        type: "dialogue",
        text: "It has your name on it.",
        speaker: "oren",
        raw: "",
        dirty: false,
      },
    ],
    meta: {
      version: 3,
      statuses: {},
      outline: { premise: "A courier carries a treasonous letter north." },
      characters: [
        { id: "mara", name: "Mara", color: "#111111", role: "Courier" },
        { id: "oren", name: "Oren", color: "#222222", role: "Brother" },
      ],
      lore: [
        {
          id: "winter-court",
          title: "Winter Court",
          description: "The queen's northern seat.",
          characterIds: [],
          tags: ["place"],
        },
      ],
      chapters: {
        ch1: {
          act: "setup",
          plotPoint: "inciting",
          premise: "A sealed summons arrives.",
          goal: "Keep Oren home.",
          conflict: "The queen named him directly.",
          turn: "Mara goes in his place.",
          characterIds: ["mara", "oren"],
          cards: [
            {
              id: "card-1",
              title: "The seal breaks",
              intention: "Reveal the summons.",
              characterIds: ["mara", "oren"],
              loreIds: ["winter-court"],
              continuityFlags: [],
            },
          ],
        },
      },
    },
  } as never);
});

describe("buildGuidedOutlineContext", () => {
  it("grounds the guide in the outline, reference data, and live chapter prose", () => {
    expect(buildGuidedOutlineContext("ch1")).toEqual({
      chapterId: "ch1",
      chapterTitle: "The Winter Letter",
      storyPremise: "A courier carries a treasonous letter north.",
      act: "setup",
      plotPoint: "inciting",
      premise: "A sealed summons arrives.",
      goal: "Keep Oren home.",
      conflict: "The queen named him directly.",
      turn: "Mara goes in his place.",
      cards: [
        {
          id: "card-1",
          title: "The seal breaks",
          intention: "Reveal the summons.",
          characterIds: ["mara", "oren"],
          loreIds: ["winter-court"],
        },
      ],
      characters: [
        { id: "mara", name: "Mara", role: "Courier" },
        { id: "oren", name: "Oren", role: "Brother" },
      ],
      lore: [
        {
          id: "winter-court",
          title: "Winter Court",
          description: "The queen's northern seat.",
          tags: ["place"],
        },
      ],
      manuscript: "Snow gathered on the unopened letter.\n\nOren: \"It has your name on it.\"",
    });
  });
});
