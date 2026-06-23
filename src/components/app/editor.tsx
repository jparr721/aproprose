// editor.tsx — the center column: the chapter as an editable block stream.

import {
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
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { useKeybinding, useKeybindingWithOptions } from "@/hooks/use-keybinding";
import type { UseKeybindingOptions } from "@/hooks/use-keybinding";
import { KEYBINDING_IDS } from "@/lib/keybindings";
import { isInAuxSurface } from "@/lib/dom";
import { PROSE_BODY_SELECTOR } from "@/lib/prose-body";
import { useDictation } from "@/lib/use-dictation";
import type { BlockType } from "@/lib/types";
import { cn } from "@/lib/utils";

// Editor history defers to native undo/redo while the AI panel or a dialog holds
// focus, so those inputs keep their own history.
const EDITOR_HISTORY_OPTIONS: UseKeybindingOptions = {
  enabled: true,
  ignoreEventWhen: (event) => isInAuxSurface(event.target as Element | null),
};

function AddBlockRow() {
  const insertAfter = useProjectStore((s) => s.insertAfter);
  const selectedId = useProjectStore((s) => s.selectedId);
  const triggerSuggest = useViewStore((s) => s.triggerSuggest);

  const add = (type: BlockType) => insertAfter(selectedId, { type });

  return (
    <div className="mt-2 flex flex-wrap gap-1.5 py-4 pl-7 font-sans">
      <Button variant="outline" size="sm" className="rounded-full border-dashed" onClick={() => add("narration")}>
        + Narration
      </Button>
      <Button variant="outline" size="sm" className="rounded-full border-dashed" onClick={() => add("dialogue")}>
        + Dialogue
      </Button>
      <Button variant="outline" size="sm" className="rounded-full border-dashed" onClick={() => add("scratchpad")}>
        + Scratchpad
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

  const chapter = project?.chapters.find((c) => c.id === activeId);

  if (!chapter) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background font-sans text-muted-foreground">
        <IconWriting className="size-8 text-faint" />
        <p className="text-sm">Select a chapter to begin.</p>
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
          <span className="font-serif text-lg italic text-muted-foreground">Chapter {chapter.label}</span>
          <span className="font-heading text-2xl font-medium tracking-tight text-foreground">
            {chapter.title}
          </span>
          <span className={cn("ml-auto font-sans text-[11.5px] tabular-nums text-faint")}>
            {blocks.length} blocks · {chapter.wordCount.toLocaleString()} words ·{" "}
            {chapterDirty ? "unsaved" : "saved"}
          </span>
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
