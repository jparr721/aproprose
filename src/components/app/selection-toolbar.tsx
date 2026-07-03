// selection-toolbar.tsx — a floating bar above a text selection inside a prose
// block body. One instance for the whole editor: it watches the focused
// [data-prose-body] textarea, and its buttons carve the selection into a new
// block (or isolate it as the same type) via the project store.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconScissors, IconBold, IconItalic } from "@tabler/icons-react";
import { toggleInlineWrap, type InlineMarker } from "@/lib/blocks/format";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/project-store";
import { selectionRect } from "@/lib/textarea-caret";
import type { BlockType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PROSE_BODY_SELECTOR } from "@/lib/prose-body";

const CONVERT_TARGETS: { type: BlockType; label: string }[] = [
  { type: "narration", label: "Narration" },
  { type: "dialogue", label: "Dialogue" },
  { type: "lore", label: "Lore" },
  { type: "scratchpad", label: "Scratchpad" },
];

interface Selection {
  blockId: string;
  start: number;
  end: number;
  rect: DOMRect;
}

export function SelectionToolbar() {
  const [sel, setSel] = useState<Selection | null>(null);
  // Narrow subscription: only the block under the live selection, so the
  // (usually dormant) toolbar doesn't re-render on every keystroke in the
  // chapter via a whole-array subscription.
  const block = useProjectStore((s) =>
    sel ? s.blocks.find((b) => b.id === sel.blockId) : undefined,
  );
  const convertSelection = useProjectStore((s) => s.convertSelection);
  const formatBlockText = useProjectStore((s) => s.formatBlockText);

  const recompute = useCallback(() => {
    const el = document.activeElement;
    if (
      !(el instanceof HTMLTextAreaElement) ||
      !el.matches(PROSE_BODY_SELECTOR) ||
      el.selectionStart === el.selectionEnd
    ) {
      setSel(null);
      return;
    }
    const host = el.closest("[data-block-id]");
    const blockId = host instanceof HTMLElement ? host.dataset.blockId : undefined;
    if (!blockId) {
      setSel(null);
      return;
    }
    const rect = selectionRect(el, el.selectionStart, el.selectionEnd);
    if (!rect) {
      setSel(null);
      return;
    }
    setSel({ blockId, start: el.selectionStart, end: el.selectionEnd, rect });
  }, []);

  useEffect(() => {
    let raf = 0;
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recompute);
    };
    document.addEventListener("selectionchange", onChange);
    window.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", onChange);
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
    };
  }, [recompute]);

  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSel(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sel]);

  if (!sel || !block) return null;

  const targets = CONVERT_TARGETS.filter((t) => t.type !== block.type);
  const apply = (type: BlockType) => {
    convertSelection(sel.blockId, sel.start, sel.end, type);
    setSel(null);
  };

  const format = (marker: InlineMarker) => {
    const el = document.activeElement;
    if (!(el instanceof HTMLTextAreaElement)) return;
    const res = toggleInlineWrap({ text: el.value, start: el.selectionStart, end: el.selectionEnd }, marker);
    formatBlockText(sel.blockId, res.text);
    // Restore the selection after React commits the new value, mirroring the
    // editor's Cmd+B path - so the writer keeps their selection and can chain
    // formats. The selectionchange listener then repositions this toolbar.
    requestAnimationFrame(() => {
      if (!el.isConnected) return;
      el.focus();
      el.setSelectionRange(res.start, res.end);
    });
  };

  // Flip below the selection when there isn't room above. 56px ≈ the block
  // action-row height that sits above a selected block near the viewport top.
  const below = sel.rect.top < 56;
  const x = sel.rect.left + sel.rect.width / 2;
  const y = below ? sel.rect.bottom + 8 : sel.rect.top - 8;

  return createPortal(
    <div
      role="toolbar"
      onMouseDown={(e) => e.preventDefault()}
      style={{ "--tb-x": `${x}px`, "--tb-y": `${y}px` } as React.CSSProperties}
      className={cn(
        "fixed z-50 left-[var(--tb-x)] top-[var(--tb-y)] -translate-x-1/2",
        below ? "translate-y-0" : "-translate-y-full",
        "flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-md",
        // Mount-only entrance; repositioning while the selection changes stays
        // instant (the component unmounts whenever the selection collapses).
        "animate-in fade-in-0 duration-150",
      )}
    >
      <Button
        variant="ghost"
        size="xs"
        onClick={() => format("**")}
        title="Bold"
        aria-label="Bold selection"
      >
        <IconBold className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => format("_")}
        title="Italic"
        aria-label="Italic selection"
      >
        <IconItalic className="size-3.5" />
      </Button>
      {targets.map((t) => (
        <Button
          key={t.type}
          variant="ghost"
          size="xs"
          onClick={() => apply(t.type)}
          title={`Convert selection to ${t.label}`}
          aria-label={`Convert selection to ${t.label}`}
        >
          {t.label}
        </Button>
      ))}
      <Button
        variant="ghost"
        size="xs"
        onClick={() => apply(block.type)}
        title="Isolate as its own block"
        aria-label="Isolate selection as its own block"
      >
        <IconScissors className="size-3.5" /> Split
      </Button>
    </div>,
    document.body,
  );
}
