// block.tsx — one authoring block: type-aware rendering + in-place editing.
//
// Out of selection a block renders like finished prose; selecting it turns the
// body into seamless borderless textareas. Hovering (or selecting) reveals the
// gutter grip and the action row: a type/speaker chip, dictation mic, an
// AI "suggest what comes next" spark, and a more-menu (move / AI cleanup / delete).

import { memo, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import {
  IconChevronDown,
  IconDotsVertical,
  IconGripVertical,
  IconMicrophone,
  IconSparkles,
  IconTrash,
  IconArrowUp,
  IconArrowDown,
  IconWand,
  IconSquareRoundedPlus,
  IconCopy,
  IconCheck,
  IconClipboardText,
  IconUserPlus,
} from "@tabler/icons-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { ColorDot } from "@/components/app/color-dot";
import { AutoGrowTextarea } from "@/components/app/auto-textarea";
import { AddCharacterDialog } from "@/components/app/add-character-dialog";
import { renderInline } from "@/components/app/inline";
import { copyText, currentSelectionText } from "@/lib/clipboard";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { useSettingsStore } from "@/stores/settings-store";
import { buildAiContext } from "@/lib/ai/context";
import { blockClickAction } from "@/lib/blocks/click";
import { cleanTranscript } from "@/lib/ai/operations";
import { describeAiError } from "@/lib/ai/errors";
import type { Block as BlockT, BlockType, Character } from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<BlockType, string> = {
  chapter: "Chapter",
  narration: "Narration",
  dialogue: "Dialogue",
  lore: "Lore note",
  scratchpad: "Scratchpad",
  latex: "Raw LaTeX",
};

const TYPE_SWATCH: Record<BlockType, string> = {
  chapter: "bg-accent-ink",
  narration: "bg-muted-foreground",
  dialogue: "bg-foreground",
  lore: "bg-lore-ink",
  scratchpad: "bg-scratch-ink",
  latex: "bg-muted-foreground",
};

const PROSE = "font-serif text-[length:var(--prose-size,17.5px)] leading-[1.65] text-foreground";

// ── Type / speaker chip ───────────────────────────────────────────────────────
function TypeChip({
  block,
  characters,
}: {
  block: BlockT;
  characters: Character[];
}) {
  const changeType = useProjectStore((s) => s.changeType);
  const changeSpeaker = useProjectStore((s) => s.changeSpeaker);
  const [addOpen, setAddOpen] = useState(false);
  const speaker = block.speaker
    ? characters.find((c) => c.id === block.speaker)
    : undefined;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" className="gap-1 text-muted-foreground">
            {speaker ? <ColorDot color={speaker.color} /> : null}
            {speaker ? speaker.name : TYPE_LABELS[block.type]}
            <IconChevronDown className="size-2.5 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {block.type === "dialogue" ? (
            <>
              <DropdownMenuLabel className="text-faint">Speaker</DropdownMenuLabel>
              {characters.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => changeSpeaker(block.id, c.id)}>
                  <ColorDot color={c.color} />
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-faint">{c.role}</span>
                  {block.speaker === c.id ? <IconCheck className="size-4 text-accent-ink" /> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => setAddOpen(true)}>
                <IconUserPlus />
                <span className="flex-1">Add character</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuLabel className="text-faint">Block type</DropdownMenuLabel>
          {(Object.keys(TYPE_LABELS) as BlockType[]).map((t) => (
            <DropdownMenuItem key={t} onSelect={() => changeType(block.id, t)}>
              <span className={cn("size-2 rounded-[2px]", TYPE_SWATCH[t])} />
              <span className="flex-1">{TYPE_LABELS[t]}</span>
              {block.type === t ? <IconCheck className="size-4 text-accent-ink" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Rendered outside the menu so closing the dropdown doesn't unmount it. */}
      <AddCharacterDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(id) => changeSpeaker(block.id, id)}
      />
    </>
  );
}

// ── Body (render or edit per type) ────────────────────────────────────────────
function BlockBody({
  block,
  editing,
  speaker,
  caret,
}: {
  block: BlockT;
  editing: boolean;
  speaker?: Character;
  /** One-shot caret placement for the block's primary textarea on edit-mode mount. */
  caret?: "start" | "end";
}) {
  const updateBlockText = useProjectStore((s) => s.updateBlockText);
  const updateBlock = useProjectStore((s) => s.updateBlock);

  switch (block.type) {
    case "chapter":
      if (block.level === "break") {
        return editing ? (
          <AutoGrowTextarea
            value={block.text}
            onChange={(v) => updateBlockText(block.id, v)}
            autoFocus
            caret={caret}
            placeholder="* * *"
            className="text-center font-serif text-muted-foreground"
          />
        ) : (
          <div className="py-4 text-center font-serif tracking-[0.3em] text-muted-foreground">
            {block.text || <span className="text-faint">* * *</span>}
          </div>
        );
      }
      return editing ? (
        <AutoGrowTextarea
          value={block.text}
          onChange={(v) => updateBlockText(block.id, v)}
          autoFocus
          caret={caret}
          placeholder="Scene heading"
          className="text-center font-serif text-2xl font-medium tracking-wide text-foreground"
        />
      ) : (
        <h2 className="my-2 text-center font-serif text-2xl font-medium tracking-wide text-foreground">
          {block.text || <span className="text-faint">Scene heading</span>}
        </h2>
      );

    case "dialogue":
      return (
        <div className="flex flex-col gap-1">
          {speaker ? (
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <ColorDot color={speaker.color} />
              {speaker.name}
            </div>
          ) : null}
          {editing ? (
            <>
              <AutoGrowTextarea
                value={block.text}
                onChange={(v) => updateBlockText(block.id, v)}
                autoFocus
                caret={caret}
                placeholder="What do they say?"
                className={PROSE}
                proseBody
              />
              <AutoGrowTextarea
                value={block.beat ?? ""}
                onChange={(v) => updateBlock(block.id, { beat: v })}
                placeholder="Action beat (optional)"
                className="font-serif text-[length:calc(var(--prose-size,17.5px)-1.5px)] leading-[1.6] text-muted-foreground"
              />
            </>
          ) : (
            <>
              <p className={PROSE}>
                <span className="text-faint">“</span>
                {renderInline(block.text)}
                <span className="text-faint">”</span>
              </p>
              {block.beat ? (
                <p className="font-serif text-[length:calc(var(--prose-size,17.5px)-1.5px)] leading-[1.6] text-muted-foreground">
                  {renderInline(block.beat)}
                </p>
              ) : null}
            </>
          )}
        </div>
      );

    case "lore":
    case "scratchpad": {
      const isLore = block.type === "lore";
      return (
        <div
          className={cn(
            "rounded-lg border p-3",
            isLore
              ? "border-lore-edge bg-lore-tint text-lore-ink"
              : "border-scratch-edge bg-scratch-tint text-scratch-ink",
          )}
        >
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em] opacity-70">
              {isLore ? "Lore · won't render" : "Scratchpad · won't render"}
            </span>
            {isLore && (block.title || editing) ? (
              editing ? (
                <input
                  value={block.title ?? ""}
                  onChange={(e) => updateBlock(block.id, { title: e.currentTarget.value })}
                  placeholder="Title"
                  className="border-0 bg-transparent p-0 text-xs font-semibold outline-none placeholder:opacity-50"
                />
              ) : (
                <span className="text-xs font-semibold">{block.title}</span>
              )
            ) : null}
          </div>
          {editing ? (
            <AutoGrowTextarea
              value={block.text}
              onChange={(v) => updateBlockText(block.id, v)}
              autoFocus
              caret={caret}
              placeholder={isLore ? "Worldbuilding note" : "Brainstorm, reminders"}
              className="text-[13px] leading-[1.55]"
              proseBody
            />
          ) : (
            <p className="text-[13px] leading-[1.55]">{renderInline(block.text)}</p>
          )}
        </div>
      );
    }

    case "latex":
      return editing ? (
        <AutoGrowTextarea
          value={block.text}
          onChange={(v) => updateBlockText(block.id, v)}
          autoFocus
          caret={caret}
          className="rounded-md border border-border bg-muted p-2.5 font-mono text-[12.5px] leading-[1.6] text-muted-foreground"
        />
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-2.5 font-mono text-[12.5px] leading-[1.6] text-muted-foreground">
          {block.text}
        </pre>
      );

    case "narration":
    default:
      return editing ? (
        <AutoGrowTextarea
          value={block.text}
          onChange={(v) => updateBlockText(block.id, v)}
          autoFocus
          caret={caret}
          placeholder="Write"
          className={PROSE}
          proseBody
        />
      ) : (
        <p className={PROSE}>
          {block.text ? renderInline(block.text) : <span className="text-faint">Empty</span>}
        </p>
      );
  }
}

// A whole block as readable plain text, for the "Copy block" context action.
function blockPlainText(block: BlockT, characters: Character[]): string {
  switch (block.type) {
    case "chapter":
      return block.text;
    case "dialogue": {
      const sp = block.speaker ? characters.find((c) => c.id === block.speaker) : undefined;
      const quote = `"${block.text}"`;
      const head = sp ? `${sp.name}: ${quote}` : quote;
      return block.beat ? `${head}\n${block.beat}` : head;
    }
    case "lore":
    case "scratchpad":
      return block.title ? `${block.title}\n${block.text}` : block.text;
    default:
      return block.text;
  }
}

// ── Block ─────────────────────────────────────────────────────────────────────
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
  const moveBlock = useProjectStore((s) => s.moveBlock);
  const deleteBlock = useProjectStore((s) => s.deleteBlock);
  const updateBlockText = useProjectStore((s) => s.updateBlockText);
  const blockStyle = useSettingsStore((s) => s.blockStyle);
  const triggerSuggest = useViewStore((s) => s.triggerSuggest);
  const blocks = useProjectStore((s) => s.blocks);
  const insertAfter = useProjectStore((s) => s.insertAfter);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useSortable({ id: block.id });

  const [cleaning, setCleaning] = useState(false);
  // Text selected at right-click time — captured before Radix opens its menu and
  // moves focus, which would otherwise drop the selection (see onContextMenuCapture).
  const [selText, setSelText] = useState("");
  const speaker = block.speaker
    ? characters.find((c) => c.id === block.speaker)
    : undefined;
  // Selection (highlight) and editing (caret in the textarea) are now distinct:
  // a block is only editing when it's the selected block AND the store's editing
  // flag is set.
  const editing = selected && storeEditing;
  // The one-shot caret hint only applies to the block currently in edit mode.
  const caret = editing && editCaret ? editCaret : undefined;
  // The active block plus every Cmd/Ctrl-clicked member of the multi-selection
  // get the selected highlight; only the active block (`selected`) shows the
  // action row and can enter edit mode.
  const highlighted = selected || inMultiSelection;
  const isProse = block.type === "narration" || block.type === "dialogue";
  const cardChrome = blockStyle === "cards" && isProse;

  const onMic = () => {
    select(block.id);
    if (!dictation.supported) {
      toast.info("Dictation isn't available in this webview", {
        description: "Use your OS dictation shortcut — it types into the focused block.",
      });
      return;
    }
    dictation.toggle();
  };

  const onClean = async () => {
    if (!block.text.trim()) return;
    setCleaning(true);
    const t = toast.loading("Cleaning up with AI");
    try {
      const cleaned = await cleanTranscript(block.text, buildAiContext(block.id));
      updateBlockText(block.id, cleaned.trim());
      toast.success("Tidied up", { id: t });
    } catch (e) {
      toast.error("Couldn't reach the model", { id: t, description: describeAiError(e) });
    } finally {
      setCleaning(false);
    }
  };

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

  const insertAbove = () => {
    const idx = blocks.findIndex((b) => b.id === block.id);
    const prevId = idx > 0 ? blocks[idx - 1].id : null;
    insertAfter(prevId);
  };

  const insertBelow = () => {
    insertAfter(block.id);
  };

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
            highlighted
              ? "border-select-edge bg-card"
              : "hover:bg-muted/50",
            cardChrome && "border-border bg-card px-3 py-3",
            cardChrome && highlighted && "border-select-edge",
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
            <BlockBody block={block} editing={editing} speaker={speaker} caret={caret} />
          </div>

          {/* actions */}
          <div
            className={cn(
              "absolute right-2 top-0 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm",
              "group-hover:flex has-[[data-state=open]]:flex",
              selected && "flex",
            )}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <TypeChip block={block} characters={characters} />
            <Button
              variant="ghost"
              size="icon-sm"
              title="Dictate into this block"
              aria-pressed={dictation.listening && selected}
              className={cn(
                dictation.listening && selected && "text-destructive",
              )}
              onClick={onMic}
            >
              <IconMicrophone className={cn(dictation.listening && selected && "animate-pulse")} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Suggest what comes next here"
              onClick={() => {
                select(block.id);
                triggerSuggest();
              }}
            >
              <IconSparkles className="text-ai-ink" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" title="More">
                  <IconDotsVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => moveBlock(block.id, -1)}>
                  <IconArrowUp /> Move up
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => moveBlock(block.id, 1)}>
                  <IconArrowDown /> Move down
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => insertAbove()}>
                  <IconSquareRoundedPlus /> Insert block above
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => insertBelow()}>
                  <IconSquareRoundedPlus /> Insert block below
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={cleaning || !block.text.trim()} onSelect={() => void onClean()}>
                  <IconWand /> Clean up with AI
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => deleteBlock(block.id)}>
                  <IconTrash /> Delete block
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem disabled={!selText.trim()} onSelect={() => void onCopySelection()}>
          <IconCopy /> Copy
        </ContextMenuItem>
        <ContextMenuItem disabled={!blockText.trim()} onSelect={() => void onCopyBlock()}>
          <IconClipboardText /> Copy block
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => moveBlock(block.id, -1)}>
          <IconArrowUp /> Move up
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => moveBlock(block.id, 1)}>
          <IconArrowDown /> Move down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => insertAbove()}>
          <IconSquareRoundedPlus /> Insert block above
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => insertBelow()}>
          <IconSquareRoundedPlus /> Insert block below
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={cleaning || !block.text.trim()} onSelect={() => void onClean()}>
          <IconWand /> Clean up with AI
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => deleteBlock(block.id)}>
          <IconTrash /> Delete block
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const Block = memo(BlockImpl);
