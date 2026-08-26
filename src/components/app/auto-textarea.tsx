// auto-textarea.tsx — a borderless textarea that grows to fit its content, so
// editing a block feels like editing prose in place rather than a form field.
//
// Sizing is the CSS grid-replica technique: an invisible div renders the same
// text in the same grid cell, so the cell is content-height from the first
// layout and the textarea just stretches to fill it. The textarea never exists
// in a collapsed one-row state — the old JS measure (height "auto" → scrollHeight)
// did, which shrank the document on mount and let the browser clamp the scroll
// viewport before the effect could preserve it: the "page snaps when I click a
// block near the end of the chapter" bug. No measuring also means height stays
// correct across pane resizes and prose-size changes for free.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PROSE_BODY_ATTR } from "@/lib/prose-body";

export function AutoGrowTextarea({
  value,
  onChange,
  className,
  autoFocus,
  placeholder,
  ariaLabel,
  disabled,
  onKeyDown,
  proseBody,
  caret,
  sizingSuffix,
  deferUpdates = false,
}: {
  value: string;
  onChange: (value: string) => void;
  /**
   * The block type's typography/spacing, applied to the sizing wrapper. The
   * replica and the textarea both inherit it, so their metrics can never drift.
   */
  className?: string;
  autoFocus?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Mark this as a carve-eligible prose body (selection toolbar + split shortcut). */
  proseBody?: boolean;
  /**
   * Sizing-only text appended to the replica — decoration the read view renders
   * inline after the text (dialogue's closing quote) so both modes wrap alike.
   */
  sizingSuffix?: string;
  /** Keep typing local and commit the final draft on blur or a command chord. */
  deferUpdates?: boolean;
  /**
   * One-shot caret placement on mount: `"start"` for `i` / new-block insert,
   * `"end"` to land at the end, a number for an exact offset (block merges).
   * Omit to leave the native caret (click-to-edit).
   */
  caret?: "start" | "end" | number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);

  useEffect(() => {
    if (!deferUpdates || value === draftRef.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [deferUpdates, value]);

  const commitDraft = () => {
    if (!deferUpdates || draftRef.current === value) return;
    onChange(draftRef.current);
  };

  const displayValue = deferUpdates ? draft : value;

  // Focus + caret placement once when the textarea mounts (the block entering
  // edit mode). Focus is imperative — React's autoFocus attribute calls focus()
  // without preventScroll, and the browser's reveal-scroll is a viewport jump
  // when the block pokes past the fold. The caller decides if scrolling is
  // wanted (nav keys already call scrollSelectedIntoView).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (autoFocus) el.focus({ preventScroll: true });
    if (caret === undefined) return;
    const pos =
      caret === "start" ? 0 : caret === "end" ? el.value.length : Math.min(caret, el.value.length);
    el.setSelectionRange(pos, pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
  }, []);

  return (
    <div className={cn("grid", className)}>
      {/* The replica owns the cell height. The trailing space keeps a trailing
          newline (and the empty value) one line tall, matching the textarea. */}
      <div aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words">
        {`${displayValue || placeholder || ""}${sizingSuffix ?? ""} `}
      </div>
      <textarea
        ref={ref}
        value={displayValue}
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        spellCheck
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (
            deferUpdates &&
            (event.key === "Enter" ||
              (event.key === "Backspace" &&
                event.currentTarget.selectionStart === 0 &&
                event.currentTarget.selectionEnd === 0) ||
              event.metaKey ||
              event.ctrlKey)
          ) {
            commitDraft();
          }
          onKeyDown?.(event);
        }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (!deferUpdates) {
            onChange(next);
            return;
          }
          draftRef.current = next;
          setDraft(next);
        }}
        {...(proseBody ? { [PROSE_BODY_ATTR]: "" } : {})}
        className="col-start-1 row-start-1 block h-full w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:text-faint focus:ring-0"
      />
    </div>
  );
}
