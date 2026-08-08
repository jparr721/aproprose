// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

vi.mock("@/lib/tauri", () => ({
  compileProject: vi.fn(),
  openProject: vi.fn(),
  createProject: vi.fn(),
  writeSkeleton: vi.fn(),
  deleteChapterCmd: vi.fn(),
  migrateToManaged: vi.fn(),
  pickProjectDir: vi.fn(),
  readAppData: vi.fn().mockResolvedValue(null),
  readPdf: vi.fn().mockResolvedValue(null),
  readProjectMeta: vi.fn().mockResolvedValue(null),
  readTextFile: vi.fn(),
  writeAppData: vi.fn().mockResolvedValue(undefined),
  writeProjectMeta: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn(),
}));

import { AppSidebar } from "@/components/app/app-sidebar";
import { CharacterDetailSheet } from "@/components/app/character/character-detail-sheet";
import { SidebarProvider } from "@/components/ui/sidebar";
import { CHARACTER_COLORS } from "@/lib/characters/colors";
import { CURRENT_VERSION } from "@/lib/migration";
import { emptyProjectKnowledge } from "@/lib/story-knowledge/model";
import { useCharacterSheetStore } from "@/stores/character-sheet-store";
import { useProjectStore } from "@/stores/project-store";

const project = {
  root: "/books/quiet-novel",
  name: "Quiet Novel",
  mainFile: "main.tex",
  title: "Quiet Novel",
  author: "Author",
  metadata: {
    title: "Quiet Novel",
    subtitle: "",
    author: "Author",
    publisher: "",
    isbn: "",
  },
  chapters: [],
};

const profile = {
  appearance: "Short, with dark curls.",
  mannerisms: "Taps the table while thinking.",
  motivations: "Protect the town.",
  relationships: "Sister to Ivo.",
  history: "Raised above the old harbor.",
  voice: "Direct and warm.",
};

beforeEach(() => {
  useCharacterSheetStore.setState({ characterId: null, view: "manual" });
  useProjectStore.setState({
    project,
    meta: {
      version: CURRENT_VERSION,
      characters: [
        {
          id: "c1",
          name: "Mara",
          role: "Courier",
          color: CHARACTER_COLORS[0],
          profile,
        },
      ],
      lore: [],
      statuses: {},
      outline: { premise: "", overview: "" },
      chapters: {},
      knowledge: emptyProjectKnowledge(),
    },
  });
});

afterEach(() => cleanup());

describe("CharacterDetailSheet", () => {
  it("opens from a sidebar character and edits every structured field", () => {
    render(<AppSidebar />, { wrapper: SidebarProvider });
    fireEvent.click(screen.getByRole("button", { name: /Mara/ }));

    expect(screen.getByRole("dialog", { name: "Edit Mara" })).toBeTruthy();

    const updates = {
      Appearance: "Tall, with a silver braid.",
      Mannerisms: "Counts each step under her breath.",
      Motivations: "Keep the archive safe.",
      Relationships: "Mentor to Ivo.",
      History: "Trained in the northern stacks.",
      Voice: "Measured and precise.",
    };

    Object.entries(updates).forEach(([label, value]) => {
      fireEvent.change(screen.getByLabelText(label), {
        target: { value },
      });
    });

    expect(useProjectStore.getState().meta.characters[0].profile).toEqual({
      appearance: updates.Appearance,
      mannerisms: updates.Mannerisms,
      motivations: updates.Motivations,
      relationships: updates.Relationships,
      history: updates.History,
      voice: updates.Voice,
    });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useCharacterSheetStore.getState()).toMatchObject({
      characterId: null,
      view: "manual",
    });
  });

  it("updates name, role, and color through existing project actions", () => {
    render(<CharacterDetailSheet />);
    act(() => useCharacterSheetStore.getState().open("c1"));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Mara Vale" },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "Archivist" },
    });
    fireEvent.click(screen.getAllByLabelText("color")[1]);

    expect(useProjectStore.getState().meta.characters[0]).toMatchObject({
      name: "Mara Vale",
      role: "Archivist",
      color: CHARACTER_COLORS[1],
    });
  });
});
