// block-body.tsx -- type-aware rendering of a block's body: finished prose out of
// edit mode, seamless borderless textareas while editing.
//
// Read view and edit surface share one class constant per type (constants.ts)
// and mount the same rows, so toggling edit mode never shifts layout — that
// parity (plus AutoGrowTextarea's replica sizing) is what keeps the viewport
// perfectly still when a block is clicked. Empty blocks show the same
// placeholder text in both modes for the same reason.

import { AutoGrowTextarea } from "@/components/app/auto-textarea";
import { ColorDot } from "@/components/app/color-dot";
import { renderInline } from "@/components/app/inline";
import { TypographyEyebrow } from "@/components/ui/typography";
import { useProjectStore } from "@/stores/project-store";
import { proseKeyAction } from "@/lib/blocks/keys";
import type { Block as BlockT, Character } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  DIALOGUE_BEAT,
  DIALOGUE_INDENT,
  DIALOGUE_QUOTE,
  LATEX_BODY,
  NOTE_BODY,
  PROSE,
  SCENE_BREAK,
  SCENE_HEADING,
} from "./constants";
import { highlightInline, highlightPlain, type FindHit } from "./highlight";

// The Enter/Backspace block grammar for a block's primary prose textarea:
// Enter splits (or continues into a fresh block at the end), Backspace at the
// start merges into / deletes into the previous block. Routing is the pure
// table in lib/blocks/keys; everything else falls through to the native key.
// The latex body and the beat/title fields keep fully native keys.
function proseKeys(block: BlockT): (e: React.KeyboardEvent<HTMLTextAreaElement>) => void {
  return (e) => {
    const el = e.currentTarget;
    const st = useProjectStore.getState();
    const idx = st.blocks.findIndex((b) => b.id === block.id);
    const action = proseKeyAction({
      key: e.key,
      shift: e.shiftKey,
      mod: e.metaKey || e.ctrlKey,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
      valueLength: el.value.length,
      blockType: block.type,
      blockEmpty: el.value.trim().length === 0,
      carriesFields: Boolean(block.beat) || Boolean(block.title),
      prevType: idx > 0 ? st.blocks[idx - 1].type : null,
    });
    if (action.kind === "none") return;
    e.preventDefault();
    if (action.kind === "split") st.splitBlock(block.id, action.at);
    else if (action.kind === "insert-after") st.insertAfter(block.id, { type: action.type });
    else if (action.kind === "merge") st.mergeWithPrevious(block.id);
    else {
      // delete-empty: the neighbour deleteBlock selects is the previous block
      // (the router guarantees one exists); resume typing at its end.
      st.deleteBlock(block.id);
      useProjectStore.getState().beginEdit("end");
    }
  };
}

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
  caret?: "start" | "end" | number;
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
            onKeyDown={proseKeys(block)}
            className={SCENE_BREAK}
          />
        ) : (
          <div className={SCENE_BREAK}>
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
          onKeyDown={proseKeys(block)}
          className={SCENE_HEADING}
        />
      ) : (
        <h2 className={SCENE_HEADING}>
          {block.text ? highlightPlain(block.text, hit) : <span className="text-faint">Scene heading</span>}
        </h2>
      );

    case "dialogue":
      return (
        <div className="flex flex-col gap-1">
          {speaker ? (
            <TypographyEyebrow className="flex items-center gap-1.5">
              <ColorDot color={speaker.color} />
              {speaker.name}
            </TypographyEyebrow>
          ) : null}
          {editing ? (
            <div className={cn(PROSE, DIALOGUE_INDENT)}>
              <span aria-hidden className={DIALOGUE_QUOTE}>
                “
              </span>
              <AutoGrowTextarea
                value={block.text}
                onChange={(v) => updateBlockText(block.id, v)}
                autoFocus
                caret={caret}
                placeholder="What do they say?"
                onKeyDown={proseKeys(block)}
                proseBody
              />
            </div>
          ) : (
            <p className={cn(PROSE, DIALOGUE_INDENT)}>
              <span aria-hidden className={DIALOGUE_QUOTE}>
                “
              </span>
              {block.text ? (
                highlightInline(block.text, hit)
              ) : (
                <span className="text-faint">What do they say?</span>
              )}
              <span className="text-faint">”</span>
            </p>
          )}
          {/* The beat row mounts only when a beat exists, in BOTH modes, so
              entering edit never grows the block. "Add action beat" lives in
              the block's action menus. */}
          {block.beat !== undefined ? (
            editing ? (
              <AutoGrowTextarea
                value={block.beat}
                onChange={(v) => updateBlock(block.id, { beat: v })}
                placeholder="Action beat"
                className={DIALOGUE_BEAT}
              />
            ) : block.beat ? (
              <p className={DIALOGUE_BEAT}>{renderInline(block.beat)}</p>
            ) : (
              <p className={cn(DIALOGUE_BEAT, "text-faint")}>Action beat</p>
            )
          ) : null}
        </div>
      );

    case "lore":
    case "scratchpad": {
      const isLore = block.type === "lore";
      const placeholder = isLore ? "Worldbuilding note" : "Brainstorm, reminders";
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
            <TypographyEyebrow className="text-current opacity-70">
              {isLore ? "Lore" : "Scratchpad"}
            </TypographyEyebrow>
            <TypographyEyebrow className="text-current opacity-45">won't render</TypographyEyebrow>
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
              placeholder={placeholder}
              onKeyDown={proseKeys(block)}
              className={NOTE_BODY}
              proseBody
            />
          ) : (
            <p className={NOTE_BODY}>
              {block.text ? (
                highlightInline(block.text, hit)
              ) : (
                <span className="text-faint">{placeholder}</span>
              )}
            </p>
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
          className={LATEX_BODY}
        />
      ) : (
        <pre className={LATEX_BODY}>{highlightPlain(block.text, hit)}</pre>
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
          onKeyDown={proseKeys(block)}
          className={PROSE}
          proseBody
        />
      ) : (
        <p className={PROSE}>
          {block.text ? highlightInline(block.text, hit) : <span className="text-faint">Write</span>}
        </p>
      );
  }
}
