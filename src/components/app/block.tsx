// block.tsx — one authoring block: type-aware rendering + in-place editing.
//
// Out of selection a block renders like finished prose; selecting it turns the
// body into seamless borderless textareas. Hovering (or selecting) reveals the
// gutter grip and the action row: a type/speaker chip, dictation mic, an
// AI "suggest what comes next" spark, and a more-menu (move / AI cleanup / delete).

import { memo, useState } from "react";
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
  IconCheck,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ColorDot } from "@/components/app/color-dot";
import { AutoGrowTextarea } from "@/components/app/auto-textarea";
import { renderInline } from "@/components/app/inline";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { useSettingsStore } from "@/stores/settings-store";
import { buildAiContext } from "@/lib/ai/context";
import { cleanTranscript } from "@/lib/ai/operations";
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
  const speaker = block.speaker
    ? characters.find((c) => c.id === block.speaker)
    : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="gap-1 font-sans text-muted-foreground">
          {speaker ? <ColorDot color={speaker.color} /> : null}
          {speaker ? speaker.name : TYPE_LABELS[block.type]}
          <IconChevronDown className="size-2.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 font-sans">
        {block.type === "dialogue" ? (
          <>
            <DropdownMenuLabel className="text-faint">Speaker</DropdownMenuLabel>
            {characters.length === 0 ? (
              <DropdownMenuItem disabled>Add characters in the rail</DropdownMenuItem>
            ) : (
              characters.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => changeSpeaker(block.id, c.id)}>
                  <ColorDot color={c.color} />
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-faint">{c.role}</span>
                  {block.speaker === c.id ? <IconCheck className="size-3.5 text-accent-ink" /> : null}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel className="text-faint">Block type</DropdownMenuLabel>
        {(Object.keys(TYPE_LABELS) as BlockType[]).map((t) => (
          <DropdownMenuItem key={t} onSelect={() => changeType(block.id, t)}>
            <span className={cn("size-2 rounded-[2px]", TYPE_SWATCH[t])} />
            <span className="flex-1">{TYPE_LABELS[t]}</span>
            {block.type === t ? <IconCheck className="size-3.5 text-accent-ink" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Body (render or edit per type) ────────────────────────────────────────────
function BlockBody({
  block,
  editing,
  speaker,
}: {
  block: BlockT;
  editing: boolean;
  speaker?: Character;
}) {
  const updateBlockText = useProjectStore((s) => s.updateBlockText);
  const updateBlock = useProjectStore((s) => s.updateBlock);

  switch (block.type) {
    case "chapter":
      if (block.level === "break") {
        return (
          <div className="py-4 text-center font-serif tracking-[0.6em] text-muted-foreground">
            ∗ ∗ ∗
          </div>
        );
      }
      return editing ? (
        <AutoGrowTextarea
          value={block.text}
          onChange={(v) => updateBlockText(block.id, v)}
          autoFocus
          placeholder="Scene heading"
          className="text-center font-heading text-2xl font-medium tracking-wide text-foreground"
        />
      ) : (
        <h2 className="my-2 text-center font-heading text-2xl font-medium tracking-wide text-foreground">
          {block.text || <span className="text-faint">Scene heading</span>}
        </h2>
      );

    case "dialogue":
      return (
        <div className="flex flex-col gap-1">
          {speaker ? (
            <div className="flex items-center gap-1.5 font-sans text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
                placeholder="What do they say?"
                className={PROSE}
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
            <span className="font-sans text-[9.5px] font-semibold uppercase tracking-[0.1em] opacity-70">
              {isLore ? "Lore · won't render" : "Scratchpad · won't render"}
            </span>
            {isLore && (block.title || editing) ? (
              editing ? (
                <input
                  value={block.title ?? ""}
                  onChange={(e) => updateBlock(block.id, { title: e.currentTarget.value })}
                  placeholder="Title"
                  className="border-0 bg-transparent p-0 font-sans text-xs font-semibold outline-none placeholder:opacity-50"
                />
              ) : (
                <span className="font-sans text-xs font-semibold">{block.title}</span>
              )
            ) : null}
          </div>
          {editing ? (
            <AutoGrowTextarea
              value={block.text}
              onChange={(v) => updateBlockText(block.id, v)}
              autoFocus
              placeholder={isLore ? "Worldbuilding note…" : "Brainstorm, reminders…"}
              className="font-sans text-[13px] leading-[1.55]"
            />
          ) : (
            <p className="font-sans text-[13px] leading-[1.55]">{renderInline(block.text)}</p>
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
          placeholder="Write…"
          className={PROSE}
        />
      ) : (
        <p className={PROSE}>
          {block.text ? renderInline(block.text) : <span className="text-faint">Empty</span>}
        </p>
      );
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
  const characters = useProjectStore((s) => s.meta.characters);
  const select = useProjectStore((s) => s.select);
  const moveBlock = useProjectStore((s) => s.moveBlock);
  const deleteBlock = useProjectStore((s) => s.deleteBlock);
  const updateBlockText = useProjectStore((s) => s.updateBlockText);
  const blockStyle = useSettingsStore((s) => s.blockStyle);
  const triggerSuggest = useViewStore((s) => s.triggerSuggest);

  const [cleaning, setCleaning] = useState(false);
  const speaker = block.speaker
    ? characters.find((c) => c.id === block.speaker)
    : undefined;
  const editing = selected && !(block.type === "chapter" && block.level === "break");
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
    const t = toast.loading("Cleaning up with AI…");
    try {
      const cleaned = await cleanTranscript(block.text, buildAiContext(block.id));
      updateBlockText(block.id, cleaned.trim());
      toast.success("Tidied up", { id: t });
    } catch (e) {
      toast.error("Couldn't reach the model", { id: t, description: String(e) });
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div
      data-block-id={block.id}
      onMouseDown={() => select(block.id)}
      className={cn(
        "group relative flex gap-1.5 rounded-lg border-l-[3px] py-1.5 pl-1.5 pr-2 transition-colors",
        selected
          ? "border-l-accent-ink bg-card"
          : "border-l-transparent hover:bg-muted/50",
        cardChrome && "border border-l-[3px] border-border bg-card px-3 py-3",
        cardChrome && selected && "border-l-accent-ink",
      )}
    >
      {/* gutter */}
      <div className="flex w-5 shrink-0 justify-center pt-1 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="cursor-grab text-faint" title="Drag handle — use ⋯ to move">
          <IconGripVertical className="size-3.5" />
        </span>
      </div>

      {/* body */}
      <div className="min-w-0 flex-1">
        <BlockBody block={block} editing={editing} speaker={speaker} />
      </div>

      {/* actions */}
      <div
        className={cn(
          "absolute right-2 top-0 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm",
          "group-hover:flex",
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
          <DropdownMenuContent align="end" className="w-48 font-sans">
            <DropdownMenuItem onSelect={() => moveBlock(block.id, -1)}>
              <IconArrowUp /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => moveBlock(block.id, 1)}>
              <IconArrowDown /> Move down
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
  );
}

export const Block = memo(BlockImpl);
