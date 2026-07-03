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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  // Selection (highlight) and editing (caret in the textarea) are distinct: a block
  // is only editing when it's the selected block AND the store's editing flag is
  // set. Both derive per-block here so a global edit-mode flip re-renders only
  // the block it affects, not the whole chapter.
  const editing = useProjectStore((s) => s.editing && s.selectedId === block.id);
  // The one-shot caret hint only applies to the block currently in edit mode.
  const caret = useProjectStore((s) =>
    s.editing && s.selectedId === block.id && s.editCaret != null ? s.editCaret : undefined,
  );
  const characters = useProjectStore((s) => s.meta.characters);
  const select = useProjectStore((s) => s.select);
  const toggleSelection = useProjectStore((s) => s.toggleSelection);
  const setSelection = useProjectStore((s) => s.setSelection);
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
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  // Text selected at right-click time — captured before Radix opens its menu and
  // moves focus, which would otherwise drop the selection (see onContextMenuCapture).
  const [selText, setSelText] = useState("");
  const speaker = findSpeaker(block, characters);
  // The active block plus every Cmd/Ctrl-clicked member of the multi-selection get
  // the selected highlight; only the active block (`selected`) shows the action row
  // and can enter edit mode.
  const highlighted = selected || inMultiSelection;

  const actions = useBlockActions(block);
  // Tinted note cards own their surface; the row treats them specially (no
  // hover wash, edge-only selection) so they never read as a box in a box.
  const isCard = block.type === "lore" || block.type === "scratchpad";
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
            // Click-time reads: subscribing to selectedIds.length / editing here
            // would re-render every block whenever any block's mode changes.
            const st = useProjectStore.getState();
            const action = blockClickAction({
              button: e.button,
              modifier: e.metaKey || e.ctrlKey,
              shift: e.shiftKey,
              selected,
              multiActive: st.selectedIds.length > 0,
              editing: st.editing,
            });
            if (action === "toggle") toggleSelection(block.id);
            else if (action === "select") select(block.id);
            else if (action === "edit") beginEdit();
            else if (action === "range") {
              // Contiguous span from the active block to this one, walked in
              // click direction so the clicked block ends up active. Suppress
              // the browser's shift-extend text selection across blocks.
              e.preventDefault();
              const anchor = st.selectedId;
              const ids = st.blocks.map((b) => b.id);
              const from = anchor ? ids.indexOf(anchor) : -1;
              const to = ids.indexOf(block.id);
              if (from === -1 || to === -1 || from === to) {
                select(block.id);
                return;
              }
              const step = from < to ? 1 : -1;
              const span: string[] = [];
              for (let i = from; i !== to + step; i += step) span.push(ids[i]);
              setSelection(span);
            }
          }}
          onContextMenuCapture={() => setSelText(currentSelectionText())}
          // dnd-kit drives the live drag offset and the FLIP ease of displaced
          // siblings; surface both as CSS vars (per the no-inline-style rule).
          // While a drag is idle the transition var is unset and the fallback
          // color transition applies.
          style={
            {
              "--dnd-transform": CSS.Transform.toString(transform),
              "--dnd-transition": transition,
            } as CSSProperties
          }
          className={cn(
            // The gutter hangs in the left margin (-ml-7 = pl-0 + w-6 + gap-1),
            // so prose, chapter header, and add-row share one text axis.
            "group relative -ml-7 flex gap-1 rounded-lg border border-transparent py-1.5 pl-0 pr-2",
            "scroll-mt-12 scroll-mb-8 [transform:var(--dnd-transform,none)]",
            "[transition:var(--dnd-transition,color_120ms,background-color_120ms,border-color_120ms)]",
            // Tinted note cards draw their own surface; the row highlight would
            // double-box them, so they take only the selection edge.
            highlighted
              ? isCard
                ? "border-select-edge"
                : "border-select-edge bg-select-tint"
              : !isCard && "hover:bg-muted/50",
            isDragging && "z-10 opacity-90 shadow-lg",
          )}
        >
          {/* gutter — drag handle */}
          <div className="flex w-6 shrink-0 justify-center pt-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  ref={setActivatorNodeRef}
                  {...attributes}
                  {...listeners}
                  aria-label="Drag to reorder block"
                  className="inline-flex h-fit cursor-grab touch-none rounded-sm border-0 bg-transparent p-1 text-faint transition-colors hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
                >
                  <IconGripVertical className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">Drag to reorder</TooltipContent>
            </Tooltip>
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
