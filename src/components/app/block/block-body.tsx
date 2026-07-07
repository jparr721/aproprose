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
import { carriesTailContent } from "@/lib/blocks/dialogue";
import { proseKeyAction } from "@/lib/blocks/keys";
import { scrollBlockIntoView } from "@/lib/dom";
import type { Block as BlockT, Character } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  DIALOGUE_BEAT,
  DIALOGUE_INDENT,
  DIALOGUE_QUOTE,
  LATEX_BODY,
  NOTE_BODY,
  PLACEHOLDERS,
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
    // Everything except a bare Enter/Backspace is native; bail before touching
    // the store so ordinary typing pays nothing here. An IME Enter committing a
    // composition must also stay native or the candidate text gets mangled.
    if ((e.key !== "Enter" && e.key !== "Backspace") || e.metaKey || e.ctrlKey) return;
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const st = useProjectStore.getState();
    const idx = st.blocks.findIndex((b) => b.id === block.id);
    const action = proseKeyAction({
      key: e.key,
      shift: e.shiftKey,
      mod: false,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
      valueLength: el.value.length,
      blockType: block.type,
      blockEmpty: el.value.trim().length === 0,
      carriesFields: carriesTailContent(block) || Boolean(block.title),
      prevType: idx > 0 ? st.blocks[idx - 1].type : null,
    });
    if (action.kind === "none") return;
    e.preventDefault();
    if (action.kind === "suppress") return;
    if (action.kind === "split") st.splitBlock(block.id, action.at);
    else if (action.kind === "insert-after") st.insertAfter(block.id, { type: action.type });
    else if (action.kind === "merge") st.mergeWithPrevious(block.id);
    else {
      // delete-empty: the neighbour deleteBlock selects is the previous block
      // (the router guarantees one exists); resume typing at its end.
      st.deleteBlock(block.id);
      st.beginEdit("end");
    }
    // The target textarea focuses with preventScroll (never yank the page), so
    // structural moves do their own minimal reveal - e.g. Enter at the end of
    // the last block must bring the new empty block above the fold.
    requestAnimationFrame(() => {
      const id = useProjectStore.getState().selectedId;
      if (id) scrollBlockIntoView(id);
    });
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
            placeholder={PLACEHOLDERS.break}
            onKeyDown={proseKeys(block)}
            className={SCENE_BREAK}
          />
        ) : (
          <div className={SCENE_BREAK}>
            {block.text ? (
              highlightPlain(block.text, hit)
            ) : (
              <span className="text-faint">{PLACEHOLDERS.break}</span>
            )}
          </div>
        );
      }
      return editing ? (
        <AutoGrowTextarea
          value={block.text}
          onChange={(v) => updateBlockText(block.id, v)}
          autoFocus
          caret={caret}
          placeholder={PLACEHOLDERS.scene}
          onKeyDown={proseKeys(block)}
          className={SCENE_HEADING}
        />
      ) : (
        <h2 className={SCENE_HEADING}>
          {block.text ? (
            highlightPlain(block.text, hit)
          ) : (
            <span className="text-faint">{PLACEHOLDERS.scene}</span>
          )}
        </h2>
      );

    case "dialogue": {
      const tail = block.tail ?? [];
      const setTailText = (i: number, value: string) => {
        const next = tail.map((s, j) => (j === i ? { ...s, text: value } : s));
        updateBlock(block.id, { tail: next });
      };
      const quoteRow = (key: string, value: string, onChange: (v: string) => void, placeholder: string) => (
        <div key={key} className={cn(PROSE, DIALOGUE_INDENT)}>
          <span aria-hidden className={DIALOGUE_QUOTE}>
            {"\u201C"}
          </span>
          {editing ? (
            <AutoGrowTextarea
              value={value}
              onChange={onChange}
              autoFocus={key === "q0"}
              caret={key === "q0" ? caret : undefined}
              placeholder={placeholder}
              onKeyDown={key === "q0" ? proseKeys(block) : undefined}
              sizingSuffix={"\u201D"}
              proseBody
            />
          ) : (
            <p>
              {value ? (
                key === "q0" ? highlightInline(value, hit) : renderInline(value)
              ) : (
                <span className="text-faint">{placeholder}</span>
              )}
              <span className="text-faint">{"\u201D"}</span>
            </p>
          )}
        </div>
      );
      return (
        <div className="flex flex-col gap-1">
          {speaker ? (
            <TypographyEyebrow className="flex items-center gap-1.5">
              <ColorDot color={speaker.color} />
              {speaker.name}
            </TypographyEyebrow>
          ) : null}
          {quoteRow("q0", block.text, (v) => updateBlockText(block.id, v), PLACEHOLDERS.dialogue)}
          {tail.map((seg, i) =>
            seg.kind === "quote"
              ? quoteRow(`t${i}`, seg.text, (v) => setTailText(i, v), PLACEHOLDERS.spokenLine)
              : editing ? (
                  <AutoGrowTextarea
                    key={`t${i}`}
                    value={seg.text}
                    onChange={(v) => setTailText(i, v)}
                    placeholder={PLACEHOLDERS.beat}
                    className={DIALOGUE_BEAT}
                  />
                ) : seg.text ? (
                  <p key={`t${i}`} className={DIALOGUE_BEAT}>
                    {renderInline(seg.text)}
                  </p>
                ) : (
                  <p key={`t${i}`} className={cn(DIALOGUE_BEAT, "text-faint")}>
                    {PLACEHOLDERS.beat}
                  </p>
                ),
          )}
        </div>
      );
    }

    case "lore":
    case "scratchpad": {
      const isLore = block.type === "lore";
      const placeholder = PLACEHOLDERS[block.type];
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
          placeholder={PLACEHOLDERS.narration}
          onKeyDown={proseKeys(block)}
          className={PROSE}
          proseBody
        />
      ) : (
        <p className={PROSE}>
          {block.text ? (
            highlightInline(block.text, hit)
          ) : (
            <span className="text-faint">{PLACEHOLDERS.narration}</span>
          )}
        </p>
      );
  }
}
