// right-panel.tsx -- the right-side assistant. Five functions, each backed by a real
// call to the model you picked in Settings, grounded on the current scene:
//   Suggest / Edit / Critique / Brainstorm / Continuity
// Reached from a vertical icon rail on the far-right edge; clicking the active
// icon collapses the panel to just the rail. Nothing infers on its own: each
// generating function waits for an explicit composer submit (with an optional
// steering instruction); Brainstorm streams a reply per turn; Edit returns
// per-block revisions. Results are cached per scene (useAi / ai-cache-store) and
// Brainstorm threads live in brainstorm-store keyed by chapter; both persist to
// disk per project (ai-persistence) so they survive switches, panel toggles, and
// full app restarts. Every function's composer is pinned to the bottom
// (ai-elements/prompt-input).

import { useEffect, useRef, useState } from "react";
import {
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconCheck,
  IconCopy,
  IconListTree,
  IconMessages,
  IconNotes,
  IconPencil,
  IconRefresh,
  IconSparkles,
  IconTimeline,
  IconWand,
} from "@tabler/icons-react";
import { ButtonGroup } from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageActions,
  MessageAction,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { OutlineSurface } from "@/components/app/outline/outline-surface";
import { scrollSelectedIntoView } from "@/components/app/editor";
import { selectionTargetIds, useProjectStore } from "@/stores/project-store";
import { useViewStore, type AiTab } from "@/stores/view-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSettingsDialogStore, SETTINGS_TABS } from "@/stores/settings-dialog-store";
import {
  TypographyEyebrow,
  TypographyMuted,
  TypographyP,
} from "@/components/ui/typography";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useAiActivityStore } from "@/stores/ai-activity-store";
import { useAi } from "@/hooks/use-ai";
import { useBrainstormStore } from "@/stores/brainstorm-store";
import {
  buildAiContext,
  buildEditRequest,
  buildRefineRequest,
  buildScopedContext,
  type ReadScope,
} from "@/lib/ai/context";
import { editComposerState } from "@/lib/ai/edit-composer";
import { describeAiError } from "@/lib/ai/errors";
import {
  brainstorm,
  critique,
  continuityCheck,
  editBlocks,
  suggestContinuation,
} from "@/lib/ai/operations";
import { diffWords, type DiffSegment } from "@/lib/diff/word-diff";
import type {
  Block,
  BlockEdit,
  ChatMessage,
  CritiqueNote,
  ContinuityFlag,
  SuggestResult,
  Suggestion,
} from "@/lib/types";
import { cn } from "@/lib/utils";

// -- shared bits --------------------------------------------------------------
function AiError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
      <span className="text-destructive">Couldn't reach the model.</span>
      <span className="block max-h-40 w-full overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground">
        {error}
      </span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <IconRefresh /> Try again
      </Button>
    </div>
  );
}

function LoadingLines({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full last:w-2/3" />
      ))}
    </div>
  );
}

/** Read-only note of the instruction that produced the shown result. */
function AskedCaption({ instruction }: { instruction?: string }) {
  if (!instruction) return null;
  return <TypographyMuted className="text-xs">Asked: {instruction}</TypographyMuted>;
}

/** Idle / empty-state helper copy shown before (or in place of) a result. Uses
 *  foreground ink -- not muted -- so it reads clearly against the panel in every theme. */
function PanelHint({ children }: { children: React.ReactNode }) {
  return (
    <TypographyMuted className="text-xs leading-relaxed text-foreground">
      {children}
    </TypographyMuted>
  );
}

/** Bottom-pinned composer shared by every function (ai-elements/prompt-input,
 *  which owns Enter-to-submit / Shift+Enter-newline). `allowEmpty` lets the
 *  generating tabs fire with no instruction; Brainstorm and Edit require text. */
function AiComposer({
  placeholder,
  loading,
  onSubmit,
  allowEmpty = false,
  focusSignal,
  toolbar,
  disabled,
  wholeChapter,
}: {
  placeholder: string;
  loading: boolean;
  onSubmit: (text: string) => void;
  allowEmpty?: boolean;
  focusSignal?: number;
  toolbar?: React.ReactNode;
  /** Inert composer: the textarea can't be typed into (e.g. nothing to edit). */
  disabled?: boolean;
  /** Whole-chapter scope: the op reads the whole chapter, so the anchor names the
   *  chapter rather than the cursor block. Omitted by cursor/block-only tabs. */
  wholeChapter?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusSignal !== undefined) ref.current?.querySelector("textarea")?.focus();
  }, [focusSignal]);

  return (
    <div ref={ref} className="flex shrink-0 flex-col gap-2 border-t border-border bg-card p-3">
      <ContextAnchor wholeChapter={wholeChapter ?? false} />
      {toolbar}
      <PromptInput
        onSubmit={(m) => {
          const t = m.text.trim();
          if (loading || (!t && !allowEmpty)) return;
          onSubmit(t);
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea placeholder={placeholder} disabled={loading || disabled} />
        </PromptInputBody>
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit status={loading ? "submitted" : undefined} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

/** The "you are here": the grounding the AI operation anchors to. Sits just above
 *  the composer's text input. In cursor/block mode it names the block under the
 *  caret (its text wraps over up to two lines so a longer tail reads naturally);
 *  in whole-chapter mode the caret is irrelevant, so it names the chapter being
 *  read instead of claiming to continue after the selected block. */
export function ContextAnchor({ wholeChapter }: { wholeChapter: boolean }) {
  const selectedId = useProjectStore((s) => s.selectedId);
  const blocks = useProjectStore((s) => s.blocks);
  const chapterTitle = useProjectStore((s) =>
    s.project?.chapters.find((c) => c.id === s.activeChapterId)?.title,
  );
  const block =
    !wholeChapter && selectedId ? blocks.find((b) => b.id === selectedId) : undefined;
  const text = block?.text.trim();

  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-ai-tint/40 px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <TypographyEyebrow className="text-ai-ink">
          {wholeChapter ? "Whole chapter" : block ? `Continuing after ${block.type}` : "Cursor"}
        </TypographyEyebrow>
        {block && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Scroll to block in editor"
                onClick={() => scrollSelectedIntoView()}
              >
                <IconArrowDown className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Go to block</TooltipContent>
          </Tooltip>
        )}
      </div>
      <TypographyMuted
        className={cn("line-clamp-2 text-xs", !wholeChapter && !text && "text-muted-foreground")}
      >
        {wholeChapter
          ? chapterTitle ?? "Reading every block in this chapter."
          : text || "Place your cursor in the manuscript."}
      </TypographyMuted>
    </div>
  );
}

// -- Suggest ------------------------------------------------------------------
function SuggestTab() {
  const focusTick = useViewStore((s) => s.suggestFocusTick);
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const insertAfter = useProjectStore((s) => s.insertAfter);
  const selectedId = useProjectStore((s) => s.selectedId);
  const characters = useProjectStore((s) => s.meta.characters);

  const cacheKey = `suggest:${activeChapterId ?? ""}:${selectedId ?? ""}`;
  const { data, loading, error, instruction, run } = useAi<SuggestResult>(
    (ins) => suggestContinuation({ ...buildAiContext(), instruction: ins }),
    cacheKey,
    "suggest",
  );

  const [variant, setVariant] = useState(0);
  useEffect(() => setVariant(0), [data]);

  const insert = (s: Suggestion) => {
    const speakerId =
      s.type === "dialogue" && s.speaker
        ? characters.find((c) => c.name.toLowerCase() === s.speaker?.toLowerCase())?.id
        : undefined;
    insertAfter(selectedId, { type: s.type, text: s.text, speaker: speakerId });
    requestAnimationFrame(() => scrollSelectedIntoView());
  };

  const v =
    data && data.suggestions.length > 0
      ? data.suggestions[Math.min(variant, data.suggestions.length - 1)]
      : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3.5 p-4">
          <AskedCaption instruction={instruction} />
          {loading ? (
            <LoadingLines rows={5} />
          ) : error ? (
            <AiError error={error} onRetry={() => run(instruction)} />
          ) : !data ? (
            <PanelHint>
              Generate reads the scene up to your cursor and proposes three ways to continue.
            </PanelHint>
          ) : !v ? (
            <PanelHint>No suggestion.</PanelHint>
          ) : (
            <>
              <div className="flex flex-col gap-2.5 rounded-xl border border-ai-edge bg-ai-tint p-3">
                <div className="flex items-center justify-between">
                  <TypographyEyebrow className="text-ai-ink">
                    {v.type === "dialogue"
                      ? v.speaker
                        ? `Dialogue: ${v.speaker}`
                        : "Dialogue"
                      : "Narration"}
                  </TypographyEyebrow>
                  <ButtonGroup>
                    {data.suggestions.map((_, i) => (
                      <Button
                        key={i}
                        size="sm"
                        variant={i === variant ? "default" : "outline"}
                        onClick={() => setVariant(i)}
                      >
                        {i + 1}
                      </Button>
                    ))}
                  </ButtonGroup>
                </div>
                <TypographyP className={cn("mt-0 text-sm", v.type === "narration" && "text-muted-foreground")}>
                  {v.type === "dialogue" ? `"${v.text}"` : v.text}
                </TypographyP>
                <div className="flex flex-col gap-0.5 border-t border-ai-edge pt-2">
                  <TypographyEyebrow className="text-ai-ink/70">
                    Why
                  </TypographyEyebrow>
                  <TypographyMuted className="text-xs">{v.rationale}</TypographyMuted>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => insert(v)}>
                    Insert below
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => run(instruction)}>
                    Try again
                  </Button>
                </div>
              </div>

              {data.followups.length > 0 ? (
                <>
                  <Separator />
                  <div className="flex flex-col gap-1">
                    <TypographyEyebrow>
                      After this, you could:
                    </TypographyEyebrow>
                    {data.followups.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground"
                      >
                        <IconArrowRight className="size-3 shrink-0 text-muted-foreground" />
                        {f}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
      <AiComposer
        placeholder="Ask for a direction, e.g. more tension, have her lie (optional)"
        loading={loading}
        onSubmit={(t) => run(t || undefined)}
        allowEmpty
        focusSignal={focusTick}
      />
    </div>
  );
}

// -- Critique -----------------------------------------------------------------
const NOTE_TONE: Record<CritiqueNote["kind"], string> = {
  strength: "bg-success/15 text-success",
  watch: "bg-warning/15 text-warning",
  idea: "bg-ai-tint text-ai-ink",
};
const NOTE_WORD: Record<CritiqueNote["kind"], string> = {
  strength: "Working",
  watch: "Watch",
  idea: "Idea",
};

function CritiqueTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const selectedId = useProjectStore((s) => s.selectedId);
  const [scope, setScope] = useState<ReadScope>("cursor");
  // Cursor scope keys on the selection; chapter scope ignores it (whole chapter).
  const cacheKey = `critique:${activeChapterId ?? ""}:${scope}:${
    scope === "cursor" ? selectedId ?? "" : ""
  }`;
  const { data, loading, error, instruction, run } = useAi<CritiqueNote[]>(
    (ins) => critique({ ...buildScopedContext(scope), instruction: ins }),
    cacheKey,
    "critique",
  );
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-4">
          <AskedCaption instruction={instruction} />
          {loading ? (
            <LoadingLines rows={6} />
          ) : error ? (
            <AiError error={error} onRetry={() => run(instruction)} />
          ) : !data ? (
            <PanelHint>
              Generate reads{" "}
              {scope === "cursor" ? "the scene up to your cursor" : "the whole chapter"} and
              returns craft notes.
            </PanelHint>
          ) : (
            data.map((n, i) => (
              <div key={i} className="rounded-lg border border-border bg-background p-3">
                <div className="mb-1 flex items-baseline gap-2">
                  <TypographyEyebrow
                    className={cn(
                      "rounded px-1.5 py-0.5",
                      NOTE_TONE[n.kind],
                    )}
                  >
                    {NOTE_WORD[n.kind]}
                  </TypographyEyebrow>
                  <TypographyEyebrow>
                    {n.tag}
                  </TypographyEyebrow>
                </div>
                <TypographyMuted>{n.text}</TypographyMuted>
              </div>
            ))
          )}
        </div>
      </div>
      <AiComposer
        placeholder="Focus the critique, e.g. pacing, dialogue (optional)"
        loading={loading}
        onSubmit={(t) => run(t || undefined)}
        allowEmpty
        wholeChapter={scope === "chapter"}
        toolbar={
          <ScopeToggle
            value={scope}
            options={[
              { id: "cursor", label: "Up to cursor" },
              { id: "chapter", label: "Whole chapter" },
            ]}
            onChange={setScope}
            disabled={loading}
          />
        }
      />
    </div>
  );
}

// -- Continuity ---------------------------------------------------------------
const SEV_DOT: Record<ContinuityFlag["sev"], string> = {
  ok: "bg-success",
  warn: "bg-warning",
  flag: "bg-destructive",
};
const SEV_WORD: Record<ContinuityFlag["sev"], string> = {
  ok: "Clean",
  warn: "Check",
  flag: "Flag",
};

function ContinuityTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const selectedId = useProjectStore((s) => s.selectedId);
  const [scope, setScope] = useState<ReadScope>("cursor");
  // Cursor scope keys on the selection; chapter scope ignores it (whole chapter).
  const cacheKey = `continuity:${activeChapterId ?? ""}:${scope}:${
    scope === "cursor" ? selectedId ?? "" : ""
  }`;
  const { data, loading, error, instruction, run } = useAi<ContinuityFlag[]>(
    (ins) => continuityCheck({ ...buildScopedContext(scope), instruction: ins }),
    cacheKey,
    "continuity",
  );
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-4">
          <AskedCaption instruction={instruction} />
          {loading ? (
            <LoadingLines rows={6} />
          ) : error ? (
            <AiError error={error} onRetry={() => run(instruction)} />
          ) : !data ? (
            <PanelHint>
              Generate sweeps{" "}
              {scope === "cursor" ? "the scene up to your cursor" : "the whole chapter"} for
              continuity issues.
            </PanelHint>
          ) : (
            data.map((f, i) => (
              <div key={i} className="grid grid-cols-[14px_1fr] gap-2 rounded-lg border border-border p-2.5">
                <span className={cn("mt-1 size-2 rounded-full", SEV_DOT[f.sev])} />
                <div>
                  <div className="mb-0.5 flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-foreground">{f.tag}</span>
                    <TypographyEyebrow>
                      {SEV_WORD[f.sev]}
                    </TypographyEyebrow>
                  </div>
                  <TypographyMuted className="text-xs">{f.text}</TypographyMuted>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <AiComposer
        placeholder="Anything specific to check? (optional)"
        loading={loading}
        onSubmit={(t) => run(t || undefined)}
        allowEmpty
        wholeChapter={scope === "chapter"}
        toolbar={
          <ScopeToggle
            value={scope}
            options={[
              { id: "cursor", label: "Up to cursor" },
              { id: "chapter", label: "Whole chapter" },
            ]}
            onChange={setScope}
            disabled={loading}
          />
        }
      />
    </div>
  );
}

// -- Edit ---------------------------------------------------------------------
const DIFF_TONE: Record<DiffSegment["type"], string> = {
  same: "text-foreground",
  add: "rounded-sm bg-success/15 text-success",
  del: "text-muted-foreground line-through",
};

function DiffText({ segments }: { segments: DiffSegment[] }) {
  return (
    <TypographyP className="mt-0 text-sm">
      {segments.map((s, i) => (
        <span key={i} className={cn(DIFF_TONE[s.type])}>
          {s.text}
        </span>
      ))}
    </TypographyP>
  );
}

/** A mutually-exclusive scope chooser. Generic over the scope union so each tab
 *  feeds its own options (Edit: block/chapter; Critique/Continuity: cursor/chapter)
 *  while keeping the selected id type-checked against the handler. */
function ScopeToggle<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <ButtonGroup>
      {options.map((o) => (
        <Button
          key={o.id}
          size="sm"
          variant={value === o.id ? "default" : "outline"}
          disabled={disabled}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </Button>
      ))}
    </ButtonGroup>
  );
}

/** One proposed block revision: the before/after diff, its rationale, the
 *  accept/reject/refine actions, and an inline composer for refining *this*
 *  proposal in place (the model reworks the draft, not the original block).
 *  Refine state is per-card and local; the parent owns the cache mutation. */
function EditProposal({
  edit,
  block,
  onAccept,
  onReject,
  onRefine,
}: {
  edit: BlockEdit;
  block: Block;
  onAccept: () => void;
  onReject: () => void;
  /** Resolves true when the proposal changed, false when the refine was a no-op. */
  onRefine: (instruction: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [noChange, setNoChange] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (!text || refining) return;
    setRefining(true);
    setRefineError(null);
    setNoChange(false);
    try {
      const changed = await onRefine(text);
      // Clear the box on a real change (the diff now reflects it, ready for another
      // pass); keep the text on a no-op so the author can adjust and retry.
      if (changed) setValue("");
      else setNoChange(true);
    } catch (err) {
      setRefineError(describeAiError(err));
    } finally {
      setRefining(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ai-edge bg-ai-tint p-3">
      <TypographyEyebrow className="text-ai-ink">{block.type}</TypographyEyebrow>
      <DiffText segments={diffWords(block.text, edit.newText)} />
      <div className="flex flex-col gap-0.5 border-t border-ai-edge pt-2">
        <TypographyEyebrow className="text-ai-ink/70">Why</TypographyEyebrow>
        <TypographyMuted className="text-xs">{edit.reason}</TypographyMuted>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={onAccept} disabled={refining}>
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={onReject} disabled={refining}>
          Reject
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
          disabled={refining}
        >
          <IconWand /> Refine
        </Button>
      </div>
      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-1">
          <InputGroup>
            <InputGroupInput
              autoFocus
              placeholder="Refine this edit, e.g. keep it shorter, warmer"
              value={value}
              disabled={refining}
              onChange={(e) => {
                setValue(e.target.value);
                setNoChange(false);
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-xs"
                disabled={refining || !value.trim()}
                aria-label="Send refinement"
              >
                {refining ? <Spinner /> : <IconArrowUp />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {refineError ? (
            <TypographyMuted className="text-xs text-destructive">
              {refineError}
            </TypographyMuted>
          ) : noChange ? (
            <TypographyMuted className="text-xs">No further change suggested.</TypographyMuted>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function EditTab() {
  const selectedId = useProjectStore((s) => s.selectedId);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const blocks = useProjectStore((s) => s.blocks);
  const updateBlockText = useProjectStore((s) => s.updateBlockText);
  const applyBlockEdits = useProjectStore((s) => s.applyBlockEdits);
  const patch = useAiCacheStore((s) => s.patch);

  const [scope, setScope] = useState<"block" | "chapter">("block");
  // Identity of the block scope: the same targets buildEditRequest resolves,
  // sorted so the key tracks set membership, not click order, matching its
  // order-independent target list.
  const blockKey = [...selectionTargetIds(selectedIds, selectedId)].sort().join(",");
  const cacheKey = `edit:${activeChapterId ?? ""}:${scope}:${
    scope === "block" ? blockKey : ""
  }`;
  const { data, loading, error, instruction, run } = useAi<BlockEdit[]>(
    (ins) => editBlocks(buildEditRequest(scope, ins ?? "")),
    cacheKey,
    "edit",
  );

  const edits = data ?? [];
  // Resolve each edit against the live block so the diff reflects current text;
  // drop edits whose block has since been removed.
  const live = edits.flatMap((edit) => {
    const block = blocks.find((b) => b.id === edit.blockId);
    return block ? [{ edit, block }] : [];
  });

  // Eligible blocks in scope (reusing buildEditRequest's filter); 0 -> skip the call.
  const targetCount = buildEditRequest(scope, "").blocks.length;
  // The block-scope button names the editable targets it will act on: "This
  // block" for one, "These N blocks" for a multi-selection. Reuse targetCount
  // under block scope rather than recomputing the same request.
  const blockTargetCount =
    scope === "block" ? targetCount : buildEditRequest("block", "").blocks.length;
  const blockLabel = blockTargetCount > 1 ? `These ${blockTargetCount} blocks` : "This block";

  // Composer messaging/enabled state: inert when the scope resolves to no editable
  // target. `hasBlockSelection` separates "nothing selected" from "the selected
  // block isn't an editable type" so each gets the right prompt.
  const hasBlockSelection = selectionTargetIds(selectedIds, selectedId).length > 0;
  const composer = editComposerState({ scope, targetCount, hasBlockSelection });

  // Remove one edit from the cached set, reading the LATEST cached value (not the
  // render-time `edits` closure) so two rapid accept/reject clicks in the same
  // frame can't clobber each other.
  const dismiss = (blockId: string) => {
    const cur =
      (useAiCacheStore.getState().entries[cacheKey]?.data as BlockEdit[] | null) ?? [];
    patch(cacheKey, { data: cur.filter((e) => e.blockId !== blockId) });
  };
  const accept = (e: BlockEdit) => {
    updateBlockText(e.blockId, e.newText);
    dismiss(e.blockId);
  };
  // Apply every proposed edit as a SINGLE undo step, then clear the set.
  const acceptAll = () => {
    applyBlockEdits(live.map(({ edit }) => ({ id: edit.blockId, text: edit.newText })));
    patch(cacheKey, { data: [] });
  };
  const rejectAll = () => patch(cacheKey, { data: [] });

  // Refine one proposed edit in place: re-run the model with the PROPOSAL as the
  // base text (not the block's stored text), so the author can iterate on an edit
  // they like instead of regenerating from scratch. Replaces just that edit in the
  // cached set, reading the latest value so it can't clobber a sibling accept/reject.
  const refine = async (edit: BlockEdit, block: Block, instruction: string): Promise<boolean> => {
    const [result] = await editBlocks(buildRefineRequest(block, edit.newText, instruction));
    if (!result) return false; // no-op refine: keep the existing proposal as-is
    const cur =
      (useAiCacheStore.getState().entries[cacheKey]?.data as BlockEdit[] | null) ?? [];
    patch(cacheKey, {
      data: cur.map((e) => (e.blockId === edit.blockId ? result : e)),
    });
    return true;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-4">
          <AskedCaption instruction={instruction} />
          {loading ? (
            <LoadingLines rows={5} />
          ) : error ? (
            <AiError error={error} onRetry={() => run(instruction)} />
          ) : !data ? (
            <PanelHint>
              Describe an edit and pick a scope. Changes come back block by block as before/after
              diffs you can accept or reject.
            </PanelHint>
          ) : live.length === 0 ? (
            <PanelHint>No changes suggested.</PanelHint>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <TypographyEyebrow>
                  {live.length} proposed {live.length === 1 ? "edit" : "edits"}
                </TypographyEyebrow>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={acceptAll}>
                    Accept all
                  </Button>
                  <Button size="sm" variant="outline" onClick={rejectAll}>
                    Reject all
                  </Button>
                </div>
              </div>
              {live.map(({ edit, block }) => (
                <EditProposal
                  key={edit.blockId}
                  edit={edit}
                  block={block}
                  onAccept={() => accept(edit)}
                  onReject={() => dismiss(edit.blockId)}
                  onRefine={(instruction) => refine(edit, block, instruction)}
                />
              ))}
            </>
          )}
        </div>
      </div>
      <AiComposer
        placeholder={composer.placeholder}
        disabled={composer.disabled}
        loading={loading}
        wholeChapter={scope === "chapter"}
        onSubmit={(t) => {
          if (composer.disabled) return; // nothing eligible in scope; skip the model call
          run(t);
        }}
        toolbar={
          <ScopeToggle
            value={scope}
            options={[
              { id: "block", label: blockLabel },
              { id: "chapter", label: "Whole chapter" },
            ]}
            onChange={setScope}
            disabled={loading}
          />
        }
      />
    </div>
  );
}

// -- Brainstorm ---------------------------------------------------------------
const EMPTY_THREAD: ChatMessage[] = [];

/** One-click copy of a chat reply's markdown source. Reveals on message hover. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <MessageActions className="opacity-0 transition-opacity group-hover:opacity-100">
      <MessageAction
        tooltip={copied ? "Copied" : "Copy"}
        label="Copy reply"
        onClick={() => {
          // Only show the "copied" checkmark once the write actually succeeds;
          // a blocked/unavailable clipboard logs instead of flashing false success.
          navigator.clipboard
            .writeText(text)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
            .catch((e) => console.warn("[right-panel] copy failed:", e));
        }}
      >
        {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
      </MessageAction>
    </MessageActions>
  );
}

function BrainstormTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const messages = useBrainstormStore((s) =>
    activeChapterId ? s.threads[activeChapterId] ?? EMPTY_THREAD : EMPTY_THREAD,
  );
  const setThread = useBrainstormStore((s) => s.setThread);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset only the transient (non-persisted) stream/error state on chapter change;
  // the thread itself is restored from the store for the new chapter.
  useEffect(() => {
    setStreaming(null);
    setError(null);
  }, [activeChapterId]);

  // Stream a reply for a history whose last turn is the user message being answered.
  // Pinned to the chapter it was started for: if the author switches chapters mid
  // stream, the committed reply still lands on the right chapter, but the transient
  // streaming/error display does not leak into the now-visible chapter.
  const streamReply = async (history: ChatMessage[]) => {
    if (!activeChapterId) return;
    const chapterId = activeChapterId;
    const onThisChapter = () =>
      useProjectStore.getState().activeChapterId === chapterId;
    useAiActivityStore.getState().start("brainstorm");
    setStreaming("");
    setError(null);
    let acc = "";
    try {
      const result = await brainstorm(
        history.map(({ role, content }) => ({ role, content })),
        buildAiContext(),
      );
      for await (const delta of result.textStream) {
        acc += delta;
        if (onThisChapter()) setStreaming(acc);
      }
      setThread(chapterId, [...history, { role: "assistant", content: acc }]);
    } catch (e) {
      // Keep whatever streamed before the failure; surface the error alongside it.
      setThread(
        chapterId,
        acc ? [...history, { role: "assistant", content: acc }] : history,
      );
      if (onThisChapter()) setError(describeAiError(e));
    } finally {
      if (onThisChapter()) setStreaming(null);
      useAiActivityStore.getState().finish("brainstorm");
    }
  };

  const send = (text: string) => {
    if (!activeChapterId || streaming != null) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setThread(activeChapterId, next);
    void streamReply(next);
  };

  // "Try again" re-answers the last user turn, dropping any partial reply after it.
  const retry = () => {
    if (!activeChapterId || streaming != null) return;
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) return;
    const history = messages.slice(0, lastUserIdx + 1);
    setThread(activeChapterId, history);
    void streamReply(history);
  };

  return (
    <div className="flex h-full flex-col">
      <Conversation>
        <ConversationContent className="gap-4 p-4">
          {messages.length === 0 && streaming == null ? (
            <PanelHint>
              Riff on the scene: ask about motivations, plant a thread, pressure-test a beat. The AI
              reads everything up to your cursor.
            </PanelHint>
          ) : null}
          {messages.map((m, i) => (
            <Message key={i} from={m.role}>
              <MessageContent>
                {m.role === "assistant" ? (
                  <MessageResponse>{m.content}</MessageResponse>
                ) : (
                  <span className="whitespace-pre-wrap text-sm leading-[1.55]">
                    {m.content}
                  </span>
                )}
              </MessageContent>
              {m.role === "assistant" ? <CopyButton text={m.content} /> : null}
            </Message>
          ))}
          {streaming != null ? (
            <Message from="assistant">
              <MessageContent>
                {streaming === "" ? <Spinner /> : <MessageResponse>{streaming}</MessageResponse>}
              </MessageContent>
            </Message>
          ) : null}
          {error ? <AiError error={error} onRetry={retry} /> : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <AiComposer
        placeholder={activeChapterId ? "Ask, riff, push back" : "Open a chapter to brainstorm"}
        loading={streaming != null}
        onSubmit={send}
      />
    </div>
  );
}

// -- Panel shell --------------------------------------------------------------
type TabMeta = { label: string; Icon: typeof IconSparkles };

// Keyed by AiTab: adding a member to the union without a rail entry is a type error,
// so the icon rail can never silently omit a function.
const TAB_META: Record<AiTab, TabMeta> = {
  outline: { label: "Outline", Icon: IconListTree },
  suggest: { label: "Suggest", Icon: IconSparkles },
  edit: { label: "Edit", Icon: IconPencil },
  critique: { label: "Critique", Icon: IconNotes },
  brainstorm: { label: "Brainstorm", Icon: IconMessages },
  continuity: { label: "Continuity", Icon: IconTimeline },
};

// The ordered list the rail renders (insertion order of the meta map).
const TABS = (Object.entries(TAB_META) as [AiTab, TabMeta][]).map(
  ([id, meta]) => ({ id, ...meta }),
);

/** Render the body for the active tab. Only the active one is mounted at a time
 *  (intentional); each body reads its data from the stores (ai-cache / brainstorm)
 *  so results survive switching tabs and panel toggles. */
function ActivePanel({ tab }: { tab: AiTab }) {
  switch (tab) {
    case "outline":
      return <OutlineSurface />;
    case "suggest":
      return <SuggestTab />;
    case "edit":
      return <EditTab />;
    case "critique":
      return <CritiqueTab />;
    case "brainstorm":
      return <BrainstormTab />;
    case "continuity":
      return <ContinuityTab />;
  }
}

/** Shown in place of any tab body when no AI model is selected in Settings. */
function NoModelNotice() {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-3 p-6">
      <TypographyMuted className="text-sm">
        Pick an AI model in Settings to turn on the assistant.
      </TypographyMuted>
      <Button
        size="sm"
        variant="outline"
        onClick={() => useSettingsDialogStore.getState().openWithTab(SETTINGS_TABS.AI)}
      >
        Open Settings
      </Button>
    </div>
  );
}

/** The resizable content column: cursor anchor + the active tab body. Width is
 *  owned by the parent `ResizablePanel` (App.tsx); the rail is rendered separately
 *  by `RightPanelRail`. Carries `data-right-panel` so editor shortcuts treat typing
 *  in here as an aux surface (see lib/dom.ts). */
export function RightPanelContent() {
  const tab = useViewStore((s) => s.aiTab);
  const aiModel = useSettingsStore((s) => s.aiModel);
  const hydrated = useSettingsStore((s) => s.hydrated);

  // This column mounts only while the panel is open and expanded, so whichever tab
  // is shown here is the one the author is watching: clear its finished badge.
  useEffect(() => {
    useAiActivityStore.getState().markSeen(tab);
  }, [tab]);

  return (
    <aside data-right-panel className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="min-h-0 flex-1">
        {tab === "outline" || !(hydrated && !aiModel) ? (
          <ActivePanel tab={tab} />
        ) : (
          <NoModelNotice />
        )}
      </div>
    </aside>
  );
}

/** The always-visible far-right icon rail. Switching tabs expands the content;
 *  clicking the active icon collapses it back to just this rail. */
export function RightPanelRail() {
  const tab = useViewStore((s) => s.aiTab);
  const setTab = useViewStore((s) => s.setAiTab);
  const collapsed = useViewStore((s) => s.aiCollapsed);
  const setCollapsed = useViewStore((s) => s.setAiCollapsed);
  const status = useAiActivityStore((s) => s.status);

  // Click the active icon -> collapse/expand; click another -> switch + expand.
  const pick = (id: AiTab) => {
    if (id === tab) setCollapsed(!collapsed);
    else {
      setTab(id);
      setCollapsed(false);
    }
  };

  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border bg-card py-2">
      {TABS.map(({ id, label, Icon }) => {
        const active = id === tab && !collapsed;
        // The shown tab needs no flag -- its body shows the state directly and
        // opening it marks it seen. Off-screen tabs surface a pulsing dot while a
        // job runs and a solid dot once it finishes.
        const activity = active ? undefined : status[id];
        const item = (
          <div key={id} className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    activity
                      ? `${label} (${activity === "running" ? "working" : "ready"})`
                      : label
                  }
                  onClick={() => pick(id)}
                  className={cn(
                    "text-muted-foreground hover:text-foreground",
                    active && "bg-accent text-foreground",
                  )}
                >
                  <Icon className="size-[18px]" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{label}</TooltipContent>
            </Tooltip>
            {activity ? (
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute right-1 top-1 size-1.5 rounded-full bg-primary",
                  activity === "running" && "animate-pulse bg-primary/70",
                )}
              />
            ) : null}
          </div>
        );
        // Divide the Outline surface from the AI tools.
        return id === "suggest"
          ? [<div key="sep" className="my-1 h-px w-5 bg-border" />, item]
          : item;
      })}
    </nav>
  );
}
