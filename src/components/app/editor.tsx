// editor.tsx — the center column: the chapter as an editable block stream.

import { useMemo } from "react";
import {
  IconGitMerge,
  IconSparkles,
  IconWriting,
} from "@tabler/icons-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { Block } from "@/components/app/block";
import { SelectionToolbar } from "@/components/app/selection-toolbar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TypographyForeground,
  TypographyLarge,
  TypographyMuted,
  TypographyMutedSpan,
} from "@/components/ui/typography";
import { useProjectStore } from "@/stores/project-store";
import { useSyncStore } from "@/stores/sync-store";
import { useViewStore } from "@/stores/view-store";
import { useKeybinding, useKeybindingWithOptions } from "@/hooks/use-keybinding";
import type { UseKeybindingOptions } from "@/hooks/use-keybinding";
import { KEYBINDING_IDS } from "@/lib/keybindings";
import { toggleInlineWrap, type InlineMarker } from "@/lib/blocks/format";
import { isInAuxSurface } from "@/lib/dom";
import { PROSE_BODY_SELECTOR } from "@/lib/prose-body";
import { useDictation } from "@/lib/use-dictation";
import type { BlockType } from "@/lib/types";

// Editor history defers to native undo/redo while the AI panel or a dialog holds
// focus, so those inputs keep their own history.
const EDITOR_HISTORY_OPTIONS: UseKeybindingOptions = {
  enabled: true,
  ignoreEventWhen: (event) => isInAuxSurface(event.target as Element | null),
};

// After a nav-key move, bring the newly-selected block into view. The block node
// already exists (selection only restyles it), so a synchronous query is fine.
function scrollSelectedIntoView() {
  const id = useProjectStore.getState().selectedId;
  if (!id) return;
  document
    .querySelector(`[data-block-id="${id}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

function AddBlockRow() {
  const insertAfter = useProjectStore((s) => s.insertAfter);
  const selectedId = useProjectStore((s) => s.selectedId);
  const triggerSuggest = useViewStore((s) => s.triggerSuggest);

  const add = (type: BlockType) => insertAfter(selectedId, { type });

  return (
    <div className="mt-2 flex flex-wrap gap-1.5 py-4 pl-7">
      <Button variant="outline" size="sm" className="rounded-full border-dashed" onClick={() => add("narration")}>
        + Narration
      </Button>
      <Button variant="outline" size="sm" className="rounded-full border-dashed" onClick={() => add("dialogue")}>
        + Dialogue
      </Button>
      <Button variant="outline" size="sm" className="rounded-full border-dashed" onClick={() => add("scratchpad")}>
        + Scratchpad
      </Button>
      <Button variant="outline" size="sm" className="rounded-full border-dashed" onClick={() => insertAfter(selectedId, { type: "chapter", level: "break", text: "* * *" })}>
        + Scene break
      </Button>
      <Button
        size="sm"
        className="rounded-full border border-ai-edge bg-ai-tint text-ai-ink hover:bg-ai-tint hover:brightness-95"
        onClick={triggerSuggest}
      >
        <IconSparkles className="size-3.5" />
        Suggest from context
      </Button>
    </div>
  );
}

export function Editor() {
  const project = useProjectStore((s) => s.project);
  const activeId = useProjectStore((s) => s.activeChapterId);
  const blocks = useProjectStore((s) => s.blocks);
  const chapterDirty = useProjectStore((s) => s.chapterDirty);
  const selectedId = useProjectStore((s) => s.selectedId);
  const editing = useProjectStore((s) => s.editing);
  const select = useProjectStore((s) => s.select);
  const reorderBlock = useProjectStore((s) => s.reorderBlock);

  // Drag-to-reorder (grip handle). PointerSensor's 6px activation keeps a plain
  // click on the grip a selection rather than a drag; KeyboardSensor makes the
  // handle operable with space + arrows.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      reorderBlock(String(active.id), String(over.id));
    }
  };

  // One recognizer for the whole editor; dictation lands in the selected block.
  const dictation = useDictation((text) => {
    const st = useProjectStore.getState();
    const id = st.selectedId;
    if (!id) return;
    const b = st.blocks.find((x) => x.id === id);
    if (!b) return;
    st.updateBlockText(id, (b.text ? `${b.text} ` : "") + text);
  });

  // Document + history shortcuts live with the editing surface they act on.
  useKeybinding(KEYBINDING_IDS.SAVE_CHAPTER, () => void useProjectStore.getState().compileNow());
  useKeybindingWithOptions(
    KEYBINDING_IDS.UNDO,
    () => useProjectStore.getState().undo(),
    EDITOR_HISTORY_OPTIONS,
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.REDO,
    () => useProjectStore.getState().redo(),
    EDITOR_HISTORY_OPTIONS,
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.REDO_ALT,
    () => useProjectStore.getState().redo(),
    EDITOR_HISTORY_OPTIONS,
  );

  // Carve/split: Cmd+Shift+Enter. With a selection it isolates the slice as its
  // own same-type block (like the toolbar's Split); a bare caret splits in two.
  useKeybinding(KEYBINDING_IDS.SPLIT_BLOCK, () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLTextAreaElement) || !el.matches(PROSE_BODY_SELECTOR)) return;
    const host = el.closest("[data-block-id]");
    const blockId = host instanceof HTMLElement ? host.dataset.blockId : undefined;
    if (!blockId) return;
    const store = useProjectStore.getState();
    const { selectionStart, selectionEnd } = el;
    if (selectionStart !== selectionEnd) {
      const block = store.blocks.find((b) => b.id === blockId);
      if (block) store.convertSelection(blockId, selectionStart, selectionEnd, block.type);
    } else {
      store.splitBlock(blockId, selectionStart);
    }
  });

  // Inline emphasis: Cmd/Ctrl+B bold, Cmd/Ctrl+I italic. Toggle the marker around
  // the focused prose-body textarea's selection, mirroring SPLIT_BLOCK's read of
  // document.activeElement. The textarea is controlled, so the new selection is
  // restored on the next frame, after React commits the new value.
  const applyFormat = (marker: InlineMarker) => {
    const el = document.activeElement;
    if (!(el instanceof HTMLTextAreaElement) || !el.matches(PROSE_BODY_SELECTOR)) return;
    const host = el.closest("[data-block-id]");
    const blockId = host instanceof HTMLElement ? host.dataset.blockId : undefined;
    if (!blockId) return;
    const res = toggleInlineWrap({ text: el.value, start: el.selectionStart, end: el.selectionEnd }, marker);
    useProjectStore.getState().formatBlockText(blockId, res.text);
    requestAnimationFrame(() => {
      if (!el.isConnected) return;
      el.focus();
      el.setSelectionRange(res.start, res.end);
    });
  };
  useKeybindingWithOptions(KEYBINDING_IDS.FORMAT_BOLD, () => applyFormat("**"), EDITOR_HISTORY_OPTIONS);
  useKeybindingWithOptions(KEYBINDING_IDS.FORMAT_ITALIC, () => applyFormat("_"), EDITOR_HISTORY_OPTIONS);

  // Block nav/edit modal keys. `↑`/`↓`/`i` are non-chord, so they're inert while
  // a textarea is focused (edit mode); the `!editing` gate is belt-and-suspenders
  // and powers on-screen hints. All four bow out of the AI panel / dialogs.
  const navOptions: UseKeybindingOptions = useMemo(
    () => ({
      enabled: selectedId != null && !editing,
      ignoreEventWhen: (e) => isInAuxSurface(e.target as Element | null),
    }),
    [selectedId, editing],
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.NAV_PREV_BLOCK,
    () => {
      useProjectStore.getState().moveSelection(-1);
      scrollSelectedIntoView();
    },
    navOptions,
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.NAV_NEXT_BLOCK,
    () => {
      useProjectStore.getState().moveSelection(1);
      scrollSelectedIntoView();
    },
    navOptions,
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.EDIT_BLOCK,
    () => useProjectStore.getState().beginEdit("start"),
    navOptions,
  );

  // Esc exits edit mode (back to nav), or deselects when already in nav mode. It
  // fires from inside the block textarea (firesWhileEditing) but bows out of the
  // AI panel / dialogs, which own their own Esc.
  const exitOptions: UseKeybindingOptions = useMemo(
    () => ({
      enabled: selectedId != null,
      ignoreEventWhen: (e) => isInAuxSurface(e.target as Element | null),
    }),
    [selectedId],
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.EXIT_BLOCK,
    () => {
      const st = useProjectStore.getState();
      if (st.editing) st.stopEdit();
      else st.deselect();
    },
    exitOptions,
  );

  const conflictedFiles = useSyncStore((s) => s.conflictedFiles);

  const chapter = project?.chapters.find((c) => c.id === activeId);

  if (!chapter) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <IconWriting className="size-8 text-faint" />
        <TypographyMuted>Select a chapter to begin.</TypographyMuted>
      </div>
    );
  }

  if (conflictedFiles.includes(chapter.file)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-8 text-center">
        <IconGitMerge className="size-8 text-destructive" />
        <TypographyLarge>This chapter has a merge conflict</TypographyLarge>
        <TypographyMuted className="max-w-sm text-sm">
          Resolve the conflict in <span className="font-mono">{chapter.file}</span> with git, then
          sync again. Editing is disabled here until it's resolved to avoid corrupting the file.
        </TypographyMuted>
      </div>
    );
  }

  return (
    <ScrollArea
      className="h-full bg-background"
      // A press on empty editor surface (gutters, padding, the chapter header)
      // clears the selection so the active block leaves edit mode. Blocks handle
      // their own selection; buttons (the add-block row) and the scrollbar keep
      // the selection so they still act on the selected block.
      onMouseDown={(e) => {
        const t = e.target as Element;
        if (
          t.closest("[data-block-id]") ||
          t.closest("button") ||
          t.closest('[data-slot="scroll-area-scrollbar"]')
        )
          return;
        select(null);
      }}
    >
      <div className="mx-auto flex w-full max-w-[720px] flex-col px-7 pb-48 pt-9">
        <header className="mb-5 flex items-baseline gap-3 border-b border-border pb-3.5">
          <TypographyMutedSpan className="font-serif text-lg italic">
            Chapter {chapter.label}
          </TypographyMutedSpan>
          <TypographyForeground className="font-serif text-2xl font-medium tracking-tight">
            {chapter.title}
          </TypographyForeground>
          <TypographyMutedSpan className="ml-auto text-xs tabular-nums">
            {blocks.length} blocks · {chapter.wordCount.toLocaleString()} words ·{" "}
            {chapterDirty ? "unsaved" : "saved"}
          </TypographyMutedSpan>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={blocks.map((b) => b.id)}
            strategy={verticalListSortingStrategy}
          >
            {blocks.map((b) => (
              <Block key={b.id} block={b} dictation={dictation} />
            ))}
          </SortableContext>
        </DndContext>

        <AddBlockRow />
        <SelectionToolbar />
      </div>
    </ScrollArea>
  );
}
