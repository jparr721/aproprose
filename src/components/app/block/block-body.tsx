// block-body.tsx -- type-aware rendering of a block's body: finished prose out of
// edit mode, seamless borderless textareas while editing.

import { AutoGrowTextarea } from "@/components/app/auto-textarea";
import { ColorDot } from "@/components/app/color-dot";
import { renderInline } from "@/components/app/inline";
import { useProjectStore } from "@/stores/project-store";
import type { Block as BlockT, Character } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PROSE } from "./constants";
import { highlightInline, highlightPlain, type FindHit } from "./highlight";

export function BlockBody({
  block,
  editing,
  speaker,
  caret,
  hit,
}: {
  block: BlockT;
  editing: boolean;
  speaker?: Character;
  /** One-shot caret placement for the block's primary textarea on edit-mode mount. */
  caret?: "start" | "end";
  /** The active find match in this block's `text`, highlighted when not editing. */
  hit: FindHit;
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
            {block.text ? highlightPlain(block.text, hit) : <span className="text-faint">* * *</span>}
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
          {block.text ? highlightPlain(block.text, hit) : <span className="text-faint">Scene heading</span>}
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
                {highlightInline(block.text, hit)}
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
            <p className="text-[13px] leading-[1.55]">{highlightInline(block.text, hit)}</p>
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
          {highlightPlain(block.text, hit)}
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
          {block.text ? highlightInline(block.text, hit) : <span className="text-faint">Empty</span>}
        </p>
      );
  }
}
