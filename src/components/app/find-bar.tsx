// find-bar.tsx - the editor's find & replace widget (Cmd+F).
//
// Overlays the top-right of the editor. Owns its own Enter / Shift+Enter / Esc
// keys; all match/replace logic lives in the find store. Marked `data-find-widget`
// so editor history/format shortcuts stay native while typing here (see lib/dom.ts).

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import {
  IconAbc,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconLetterCase,
  IconRegex,
  IconReplace,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useFindStore } from "@/stores/find-store";
import { useProjectStore } from "@/stores/project-store";

function OptionToggle({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <InputGroupButton
      size="icon-xs"
      variant={active ? "secondary" : "ghost"}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {children}
    </InputGroupButton>
  );
}

export function FindBar() {
  const open = useFindStore((s) => s.open);
  const query = useFindStore((s) => s.query);
  const replacement = useFindStore((s) => s.replacement);
  const caseSensitive = useFindStore((s) => s.caseSensitive);
  const wholeWord = useFindStore((s) => s.wholeWord);
  const regex = useFindStore((s) => s.regex);
  const replaceExpanded = useFindStore((s) => s.replaceExpanded);
  const matches = useFindStore((s) => s.matches);
  const currentIndex = useFindStore((s) => s.currentIndex);
  const error = useFindStore((s) => s.error);
  const focusTick = useFindStore((s) => s.focusTick);
  const setQuery = useFindStore((s) => s.setQuery);
  const setReplacement = useFindStore((s) => s.setReplacement);
  const toggleCase = useFindStore((s) => s.toggleCase);
  const toggleWord = useFindStore((s) => s.toggleWord);
  const toggleRegex = useFindStore((s) => s.toggleRegex);
  const toggleReplace = useFindStore((s) => s.toggleReplace);
  const recompute = useFindStore((s) => s.recompute);
  const scrollToCurrent = useFindStore((s) => s.scrollToCurrent);
  const next = useFindStore((s) => s.next);
  const prev = useFindStore((s) => s.prev);
  const close = useFindStore((s) => s.close);
  const replaceCurrent = useFindStore((s) => s.replaceCurrent);
  const replaceAll = useFindStore((s) => s.replaceAll);

  const blocks = useProjectStore((s) => s.blocks);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-derive matches whenever the query, options, or the underlying blocks change
  // (so live edits / AI changes keep the highlight honest).
  useEffect(() => {
    if (open) recompute();
  }, [open, blocks, query, caseSensitive, wholeWord, regex, recompute]);

  // Center the active match when the SEARCH changes (query / options / a fresh
  // Cmd+F) but NOT when `blocks` change, so typing in another block with find open
  // doesn't yank the viewport. Declared after the recompute effect, and zustand's
  // set is synchronous, so the current index is already fresh here.
  useEffect(() => {
    if (open) scrollToCurrent();
  }, [open, query, caseSensitive, wholeWord, regex, focusTick, scrollToCurrent]);

  // Focus + select the query on open and on every Cmd+F (focusTick).
  useEffect(() => {
    if (!open) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [open, focusTick]);

  if (!open) return null;

  const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const onReplaceKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      replaceCurrent();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const hasMatches = matches.length > 0;
  const counter = hasMatches
    ? `${currentIndex + 1} of ${matches.length}`
    : query
      ? "No results"
      : "";

  return (
    <div
      data-find-widget
      className="absolute right-4 top-3 z-20 flex items-start gap-1 rounded-lg border border-border bg-card p-1.5 font-sans shadow-md animate-in fade-in-0 slide-in-from-top-2 duration-150"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        title={replaceExpanded ? "Hide replace" : "Show replace"}
        aria-label="Toggle replace"
        onClick={toggleReplace}
      >
        {replaceExpanded ? <IconChevronDown /> : <IconChevronRight />}
      </Button>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <InputGroup className="w-72">
            <InputGroupInput
              ref={inputRef}
              value={query}
              placeholder="Find"
              aria-invalid={error != null}
              title={error ?? undefined}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onFindKey}
            />
            <InputGroupAddon align="inline-end" className="tabular-nums text-faint">
              {counter}
            </InputGroupAddon>
            <InputGroupAddon align="inline-end">
              <OptionToggle active={caseSensitive} title="Match case" onClick={toggleCase}>
                <IconLetterCase />
              </OptionToggle>
              <OptionToggle active={wholeWord} title="Match whole word" onClick={toggleWord}>
                <IconAbc />
              </OptionToggle>
              <OptionToggle active={regex} title="Use regular expression" onClick={toggleRegex}>
                <IconRegex />
              </OptionToggle>
            </InputGroupAddon>
          </InputGroup>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
            disabled={!hasMatches}
            onClick={prev}
          >
            <IconChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Next match (Enter)"
            aria-label="Next match"
            disabled={!hasMatches}
            onClick={next}
          >
            <IconChevronDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Close (Esc)"
            aria-label="Close find"
            onClick={close}
          >
            <IconX />
          </Button>
        </div>

        {replaceExpanded ? (
          <div className="flex items-center gap-1">
            <InputGroup className="w-72">
              <InputGroupInput
                value={replacement}
                placeholder="Replace"
                onChange={(e) => setReplacement(e.target.value)}
                onKeyDown={onReplaceKey}
              />
            </InputGroup>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Replace (Enter)"
              aria-label="Replace"
              disabled={!hasMatches}
              onClick={replaceCurrent}
            >
              <IconReplace />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Replace all"
              disabled={!hasMatches}
              onClick={replaceAll}
            >
              All
            </Button>
          </div>
        ) : null}

        {error != null ? <div className="px-1 text-xs text-destructive">{error}</div> : null}
      </div>
    </div>
  );
}
