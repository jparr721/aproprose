// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agent = vi.hoisted(() => ({
  hydrateAgentCharacterSession: vi.fn(),
  stopAgentRun: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  tauriStateStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return {
    ...actual,
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
  };
});

vi.mock("@/lib/ai/agent-controller", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/agent-controller")>();
  return { ...actual, stopAgentRun: agent.stopAgentRun };
});

vi.mock("@/stores/agent-persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/agent-persistence")>();
  return {
    ...actual,
    hydrateAgentCharacterSession: agent.hydrateAgentCharacterSession,
  };
});

import { AppSidebar } from "@/components/app/app-sidebar";
import { CharacterDetailSheet } from "@/components/app/character/character-detail-sheet";
import { SidebarProvider } from "@/components/ui/sidebar";
import { CHARACTER_COLORS } from "@/lib/characters/colors";
import { CURRENT_VERSION } from "@/lib/migration";
import { emptyProjectKnowledge } from "@/lib/story-knowledge/model";
import {
  agentSessionStore,
  clearCharacterAgentSessions,
  EMPTY_AGENT_STATE,
} from "@/stores/agent-console-store";
import { useCharacterSheetStore } from "@/stores/character-sheet-store";
import { useProjectStore } from "@/stores/project-store";

const project = {
  root: "/book",
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
  agent.hydrateAgentCharacterSession.mockReset();
  agent.hydrateAgentCharacterSession.mockResolvedValue(undefined);
  agent.stopAgentRun.mockReset();
  clearCharacterAgentSessions();
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
  function renderDescribeView(characterId: string): { unmount: () => void } {
    const sessionId = { kind: "character" as const, characterId };
    agentSessionStore(sessionId).setState({
      ...EMPTY_AGENT_STATE,
      activeProjectRoot: project.root,
      hydratedProjectRoot: project.root,
      requestedProjectRoot: project.root,
    });
    const rendered = render(<CharacterDetailSheet />);
    act(() => useCharacterSheetStore.getState().open(characterId));
    fireEvent.click(screen.getByRole("button", { name: "Describe with AI" }));
    return rendered;
  }

  it("opens from a sidebar character and edits every structured field", () => {
    useCharacterSheetStore.setState({ characterId: null, view: "describe" });
    render(<AppSidebar />, { wrapper: SidebarProvider });
    fireEvent.click(screen.getByRole("button", { name: /Mara/ }));

    expect(screen.getByRole("dialog", { name: "Edit Mara" })).toBeTruthy();
    expect(useCharacterSheetStore.getState().view).toBe("manual");

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

    fireEvent.click(screen.getByRole("button", { name: "Describe with AI" }));
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

  it("leaves the sheet title font family to the shared primitive", () => {
    render(<CharacterDetailSheet />);
    act(() => useCharacterSheetStore.getState().open("c1"));

    const title = screen.getByRole("heading", { name: "Edit Mara" });
    expect(title.className.split(/\s+/)).not.toContain("font-sans");
  });

  it("hydrates the selected character session and renders its agent surface", async () => {
    renderDescribeView("c1");

    await waitFor(() => {
      expect(agent.hydrateAgentCharacterSession).toHaveBeenCalledWith(
        "/book",
        "c1",
      );
    });
    expect(agent.hydrateAgentCharacterSession).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Describe with AI" }).dataset.variant,
    ).toBe("default");
    expect(screen.getByRole("button", { name: "Manual" }).dataset.variant).toBe(
      "outline",
    );
    expect(screen.getByLabelText("Character Describe")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("Describe Mara or explore new details"),
    ).toBeTruthy();
  });

  it("stops the character run when returning to Manual", () => {
    renderDescribeView("c1");
    fireEvent.click(screen.getByRole("button", { name: "Manual" }));

    expect(agent.stopAgentRun).toHaveBeenCalledTimes(1);
    expect(agent.stopAgentRun).toHaveBeenCalledWith({
      kind: "character",
      characterId: "c1",
    });
  });

  it("stops the character run when closing the sheet", () => {
    renderDescribeView("c1");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(agent.stopAgentRun).toHaveBeenCalledTimes(1);
    expect(agent.stopAgentRun).toHaveBeenCalledWith({
      kind: "character",
      characterId: "c1",
    });
  });

  it("stops the character run exactly once when the sheet unmounts", () => {
    const { unmount } = renderDescribeView("c1");

    unmount();

    expect(agent.stopAgentRun).toHaveBeenCalledTimes(1);
    expect(agent.stopAgentRun).toHaveBeenCalledWith({
      kind: "character",
      characterId: "c1",
    });
  });

  it("stops the former session exactly once when the character changes", async () => {
    useProjectStore.setState((state) => ({
      meta: {
        ...state.meta,
        characters: [
          ...state.meta.characters,
          {
            id: "c2",
            name: "Ivo",
            role: "Archivist",
            color: CHARACTER_COLORS[1],
            profile,
          },
        ],
      },
    }));
    renderDescribeView("c1");

    act(() => {
      useCharacterSheetStore.setState({
        characterId: "c2",
        view: "describe",
      });
    });

    await waitFor(() => {
      expect(agent.hydrateAgentCharacterSession).toHaveBeenCalledWith(
        "/book",
        "c2",
      );
    });
    expect(agent.stopAgentRun.mock.calls).toEqual([
      [{ kind: "character", characterId: "c1" }],
    ]);
  });

  it("shows live character tool updates when returning to Manual", () => {
    renderDescribeView("c1");
    act(() => {
      useProjectStore.getState().updateCharacter("c1", {
        profile: {
          ...profile,
          appearance: "Tall, with a silver braid.",
        },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Manual" }));

    expect(
      (screen.getByLabelText("Appearance") as HTMLTextAreaElement).value,
    ).toBe("Tall, with a silver braid.");
  });
});
