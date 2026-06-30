// index.tsx -- one authoring block: type-aware body + in-place editing, wrapped in
// selection/drag wiring and a right-click menu.
//
// Out of selection a block renders like finished prose; selecting it turns the
// body into seamless borderless textareas (see BlockBody). Hovering (or selecting)
// reveals the gutter grip and the floating action row (BlockToolbar).

import { memo, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { IconClipboardText, IconCopy, IconGripVertical } from "@tabler/icons-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { copyText, currentSelectionText } from "@/lib/clipboard";
import { useProjectStore } from "@/stores/project-store";
import { useFindStore } from "@/stores/find-store";
import { blockClickAction } from "@/lib/blocks/click";
import type { Block as BlockT } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BlockBody } from "./block-body";
import { BlockToolbar } from "./block-toolbar";
import { BlockActionItems, useBlockActions, type BlockAction } from "./block-actions";
import { blockPlainText, findSpeaker } from "./block-text";

// Memoized: editing one block re-serializes only that block's `raw`/identity, so
// the other blocks in a long chapter don't re-render on every keystroke.
function BlockImpl({
  block,
  dictation,
}: {
  block: BlockT;
  dictation: { supported: boolean; listening: boolean; toggle: () => void };
}) {
  const selected = useProjectStore((s) => s.selectedId === block.id);
  const inMultiSelection = useProjectStore((s) => s.selectedIds.includes(block.id));
  const multiActive = useProjectStore((s) => s.selectedIds.length > 0);
  const storeEditing = useProjectStore((s) => s.editing);
  const editCaret = useProjectStore((s) => s.editCaret);
  const characters = useProjectStore((s) => s.meta.characters);
  const select = useProjectStore((s) => s.select);
  const toggleSelection = useProjectStore((s) => s.toggleSelection);
  const beginEdit = useProjectStore((s) => s.beginEdit);
  // The active find match in this block, or null for every other block (a stable
  // null, so only the current-match block and the one it just left re-render).
  const hit = useFindStore((s) =>
    s.open && s.currentIndex >= 0 && s.matches[s.currentIndex]?.blockId === block.id
      ? s.matches[s.currentIndex]
      : null,
  );
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useSortable({ id: block.id });

  // Text selected at right-click time — captured before Radix opens its menu and
  // moves focus, which would otherwise drop the selection (see onContextMenuCapture).
  const [selText, setSelText] = useState("");
  const speaker = findSpeaker(block, characters);
  // Selection (highlight) and editing (caret in the textarea) are distinct: a block
  // is only editing when it's the selected block AND the store's editing flag is set.
  const editing = selected && storeEditing;
  // The one-shot caret hint only applies to the block currently in edit mode.
  const caret = editing && editCaret ? editCaret : undefined;
  // The active block plus every Cmd/Ctrl-clicked member of the multi-selection get
  // the selected highlight; only the active block (`selected`) shows the action row
  // and can enter edit mode.
  const highlighted = selected || inMultiSelection;

  const actions = useBlockActions(block);
  // The whole block as plain text — copied verbatim and used to gate the item.
  const blockText = blockPlainText(block, characters);

  const onCopySelection = async () => {
    // selText is the snapshot taken on right-click (the menu gesture has since
    // dropped the live selection); the item is disabled when it's empty.
    if (!selText.trim()) return;
    if (!(await copyText(selText))) toast.error("Couldn't copy to the clipboard");
  };
  const onCopyBlock = async () => {
    if (!(await copyText(blockText))) toast.error("Couldn't copy to the clipboard");
  };
  const copyActions: BlockAction[] = [
    { icon: IconCopy, label: "Copy", onSelect: () => void onCopySelection(), disabled: !selText.trim() },
    { icon: IconClipboardText, label: "Copy block", onSelect: () => void onCopyBlock(), disabled: !blockText.trim() },
  ];

  return (
    <ContextMenu>
      {/* select-text overrides the trigger's default select-none (merged away by
          cn/tailwind-merge) so prose stays highlightable for "Copy". */}
      <ContextMenuTrigger asChild className="select-text">
        <div
          ref={setNodeRef}
          data-block-id={block.id}
          // Cmd/Ctrl + left press toggles the block in the multi-selection (never
          // edits). A plain left press: while a multi-selection is active it
          // collapses to just this block; otherwise the first press highlights
          // (nav mode, prose stays) and a second press on the already-selected
          // block enters edit mode, the mouseup landing the caret at the click
          // point (beginEdit passes no caret hint). Right press must NOT select,
          // or swapping prose for textareas drops the highlight being copied.
          // The routing table is `blockClickAction` (unit-tested in isolation).
          onMouseDown={(e) => {
            const action = blockClickAction({
              button: e.button,
              modifier: e.metaKey || e.ctrlKey,
              selected,
              multiActive,
              editing: storeEditing,
            });
            if (action === "toggle") toggleSelection(block.id);
            else if (action === "select") select(block.id);
            else if (action === "edit") beginEdit();
          }}
          onContextMenuCapture={() => setSelText(currentSelectionText())}
          // dnd-kit drives the live drag offset; surface it as a CSS var (per the
          // no-inline-style rule) consumed by the arbitrary transform utility.
          style={{ "--dnd-transform": CSS.Transform.toString(transform) } as CSSProperties}
          className={cn(
            "group relative flex gap-1.5 rounded-lg border border-transparent py-1.5 pl-1.5 pr-2 transition-colors [transform:var(--dnd-transform,none)]",
            highlighted ? "border-select-edge bg-card" : "hover:bg-muted/50",
            isDragging && "z-10 opacity-90 shadow-lg",
          )}
        >
          {/* gutter — drag handle */}
          <div className="flex w-5 shrink-0 justify-center pt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              title="Drag to reorder"
              aria-label="Drag to reorder block"
              className="inline-flex cursor-grab touch-none border-0 bg-transparent p-0 text-faint active:cursor-grabbing"
            >
              <IconGripVertical className="size-3.5" />
            </button>
          </div>

          {/* body */}
          <div className="min-w-0 flex-1">
            <BlockBody block={block} editing={editing} speaker={speaker} caret={caret} hit={hit} />
          </div>

          {/* actions */}
          <BlockToolbar
            block={block}
            characters={characters}
            dictation={dictation}
            selected={selected}
            actions={actions}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <BlockActionItems
          groups={[copyActions, ...actions]}
          Item={ContextMenuItem}
          Separator={ContextMenuSeparator}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const Block = memo(BlockImpl);
