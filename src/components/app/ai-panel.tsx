// ai-panel.tsx -- the right-side assistant. Five tabs, each backed by a real
// gpt-5.4-nano call grounded on the current scene:
//   Suggest / Critique / Brainstorm / Continuity / Cast
// Nothing infers on its own: each generating tab waits for an explicit composer
// submit (with an optional steering instruction); Brainstorm streams a reply per
// turn. Results for the four generating tabs are cached per scene (useAi /
// ai-cache-store) and Brainstorm threads live in brainstorm-store keyed by
// chapter. Both are persisted to disk per project (ai-persistence) so they
// survive tab switches, panel toggles, and full app restarts. Every tab's
// composer is pinned to the bottom (ai-elements/prompt-input).

import { useCallback, useEffect, useRef, useState } from "react";
import { IconArrowRight, IconCheck, IconCopy, IconRefresh } from "@tabler/icons-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
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
import { ColorAvatar } from "@/components/app/color-dot";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore, type AiTab } from "@/stores/view-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useBrainstormStore } from "@/stores/brainstorm-store";
import { buildAiContext, buildEditRequest } from "@/lib/ai/context";
import { describeAiError } from "@/lib/ai/errors";
import {
  brainstorm,
  critique,
  continuityCheck,
  detectCast,
  editBlocks,
  suggestContinuation,
} from "@/lib/ai/operations";
import { diffWords, type DiffSegment } from "@/lib/diff/word-diff";
import type {
  BlockEdit,
  CastMember,
  CastResult,
  ChatMessage,
  CritiqueNote,
  ContinuityFlag,
  SuggestResult,
  Suggestion,
} from "@/lib/types";
import { cn } from "@/lib/utils";

// -- shared bits --------------------------------------------------------------
function ContextLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 font-sans text-xs text-muted-foreground">
      <span className="size-1.5 rounded-full bg-ai-edge shadow-[0_0_0_2px_var(--ai-tint)]" />
      {children}
    </div>
  );
}

function AiError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-3 font-sans text-xs text-muted-foreground">
      <span className="text-destructive">Couldn't reach the model.</span>
      <span className="block max-h-40 w-full overflow-y-auto whitespace-pre-wrap break-words text-faint">
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
  return <p className="font-sans text-xs italic text-faint">Asked: {instruction}</p>;
}

/**
 * Cache-backed, manual async result. Idle-first: a request fires only on an
 * explicit run(instruction?) (a tab's composer submit / Try again). Results live
 * in the shared ai-cache-store keyed by `cacheKey`, so they survive remounts and
 * (via ai-persistence) app restarts; a new key (different scene / cursor) reads
 * as idle. `op` is read through a ref so each run uses the latest closure while
 * `run` stays memoised on `cacheKey` -- moving the cursor mid-flight can never
 * land a stale result against the new anchor; the in-flight run just populates
 * the old key. The instruction that produced a result is stored on the entry so
 * a remounted tab can caption it.
 */
function useAi<T>(op: (instruction?: string) => Promise<T>, cacheKey: string) {
  const entry = useAiCacheStore((s) => s.entries[cacheKey]);
  const patch = useAiCacheStore((s) => s.patch);
  const opRef = useRef(op);
  opRef.current = op;

  const run = useCallback(
    (instruction?: string) => {
      patch(cacheKey, { loading: true, error: null, instruction });
      opRef
        .current(instruction)
        .then((d) => patch(cacheKey, { data: d, loading: false, error: null }))
        .catch((e) => patch(cacheKey, { loading: false, error: describeAiError(e) }));
    },
    [cacheKey, patch],
  );

  return {
    // The cache stores `data` as `unknown`; this cast is sound because only this
    // hook writes `cacheKey`, and it only writes the `T` its own `op` produced.
    data: (entry?.data ?? null) as T | null,
    loading: entry?.loading ?? false,
    error: entry?.error ?? null,
    instruction: entry?.instruction,
    run,
  };
}

/** Bottom-pinned composer shared by every tab (ai-elements/prompt-input).
 *  Enter submits, Shift+Enter newlines. `allowEmpty` lets the generating tabs
 *  fire with no instruction (it's optional); Brainstorm requires text. */
function AiComposer({
  placeholder,
  loading,
  onSubmit,
  allowEmpty = false,
  focusSignal,
  toolbar,
}: {
  placeholder: string;
  loading: boolean;
  onSubmit: (text: string) => void;
  allowEmpty?: boolean;
  focusSignal?: number;
  toolbar?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusSignal !== undefined) ref.current?.querySelector("textarea")?.focus();
  }, [focusSignal]);

  return (
    <div ref={ref} className="flex shrink-0 flex-col gap-2 border-t border-border bg-card p-3">
      {toolbar}
      <PromptInput
        onSubmit={(m) => {
          const t = m.text.trim();
          if (loading || (!t && !allowEmpty)) return;
          onSubmit(t);
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea placeholder={placeholder} disabled={loading} />
        </PromptInputBody>
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit status={loading ? "submitted" : undefined} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

/** Display strip -- the "you are here": the block the AI operations anchor to. */
function CursorAnchor() {
  const selectedId = useProjectStore((s) => s.selectedId);
  const blocks = useProjectStore((s) => s.blocks);
  const block = selectedId ? blocks.find((b) => b.id === selectedId) : undefined;
  const text = block?.text.trim();

  return (
    <div className="flex items-center gap-2 border-b border-border bg-ai-tint/40 px-3 py-1.5">
      <span className="shrink-0 font-sans text-xs font-semibold uppercase tracking-[0.08em] text-ai-ink">
        {block ? `Continuing after ${block.type}` : "Cursor"}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "line-clamp-1",
            text
              ? "font-serif text-xs italic text-muted-foreground"
              : "font-sans text-xs text-faint",
          )}
        >
          {text || "Place your cursor in the manuscript."}
        </p>
      </div>
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
  );

  const [variant, setVariant] = useState(0);
  useEffect(() => setVariant(0), [data]);

  const insert = (s: Suggestion) => {
    const speakerId =
      s.type === "dialogue" && s.speaker
        ? characters.find((c) => c.name.toLowerCase() === s.speaker?.toLowerCase())?.id
        : undefined;
    insertAfter(selectedId, { type: s.type, text: s.text, speaker: speakerId });
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
            <p className="font-sans text-xs leading-relaxed text-faint">
              Generate reads the scene up to your cursor and proposes three ways to continue.
            </p>
          ) : !v ? (
            <p className="font-sans text-xs text-faint">No suggestion.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2.5 rounded-xl border border-ai-edge bg-ai-tint p-3">
                <div className="flex items-center justify-between">
                  <span className="font-sans text-xs font-semibold uppercase tracking-[0.06em] text-ai-ink">
                    {v.type === "dialogue"
                      ? v.speaker
                        ? `Dialogue: ${v.speaker}`
                        : "Dialogue"
                      : "Narration"}
                  </span>
                  <div className="flex gap-0.5">
                    {data.suggestions.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setVariant(i)}
                        className={cn(
                          "size-[18px] rounded font-sans text-xs tabular-nums text-ai-ink transition-opacity",
                          i === variant
                            ? "bg-card opacity-100 shadow-[0_0_0_0.5px_var(--ai-edge)]"
                            : "opacity-55 hover:opacity-100",
                        )}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                </div>
                <p
                  className={cn(
                    "font-serif text-sm leading-[1.55] text-foreground",
                    v.type === "narration" && "italic text-muted-foreground",
                  )}
                >
                  {v.type === "dialogue" ? `"${v.text}"` : v.text}
                </p>
                <div className="flex flex-col gap-0.5 border-t border-ai-edge pt-2">
                  <span className="font-sans text-xs uppercase tracking-[0.08em] text-ai-ink opacity-70">
                    Why
                  </span>
                  <p className="font-sans text-xs leading-[1.5] text-muted-foreground">{v.rationale}</p>
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
                    <span className="font-sans text-xs uppercase tracking-[0.08em] text-faint">
                      After this, you could:
                    </span>
                    {data.followups.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 font-sans text-xs text-muted-foreground"
                      >
                        <IconArrowRight className="size-3 shrink-0 text-faint" />
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
  const cacheKey = `critique:${activeChapterId ?? ""}:${selectedId ?? ""}`;
  const { data, loading, error, instruction, run } = useAi<CritiqueNote[]>(
    (ins) => critique({ ...buildAiContext(), instruction: ins }),
    cacheKey,
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
            <p className="font-sans text-xs leading-relaxed text-faint">
              Generate reads the scene up to your cursor and returns craft notes.
            </p>
          ) : (
            data.map((n, i) => (
              <div key={i} className="rounded-lg border border-border bg-background p-3">
                <div className="mb-1 flex items-baseline gap-2">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 font-sans text-xs font-semibold uppercase tracking-[0.08em]",
                      NOTE_TONE[n.kind],
                    )}
                  >
                    {NOTE_WORD[n.kind]}
                  </span>
                  <span className="font-sans text-xs uppercase tracking-[0.06em] text-muted-foreground">
                    {n.tag}
                  </span>
                </div>
                <p className="font-sans text-sm leading-[1.55] text-muted-foreground">{n.text}</p>
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
  const cacheKey = `continuity:${activeChapterId ?? ""}:${selectedId ?? ""}`;
  const { data, loading, error, instruction, run } = useAi<ContinuityFlag[]>(
    (ins) => continuityCheck({ ...buildAiContext(), instruction: ins }),
    cacheKey,
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
            <p className="font-sans text-xs leading-relaxed text-faint">
              Generate sweeps the scene up to your cursor for continuity issues.
            </p>
          ) : (
            data.map((f, i) => (
              <div key={i} className="grid grid-cols-[14px_1fr] gap-2 rounded-lg border border-border p-2.5">
                <span className={cn("mt-1 size-2 rounded-full", SEV_DOT[f.sev])} />
                <div>
                  <div className="mb-0.5 flex items-baseline gap-2">
                    <span className="font-sans text-xs font-semibold text-foreground">{f.tag}</span>
                    <span className="font-sans text-xs uppercase tracking-[0.08em] text-faint">
                      {SEV_WORD[f.sev]}
                    </span>
                  </div>
                  <p className="font-sans text-xs leading-[1.5] text-muted-foreground">{f.text}</p>
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
      />
    </div>
  );
}

// -- Cast ---------------------------------------------------------------------
function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function CastRow({ m }: { m: CastMember }) {
  return (
    <div className="grid grid-cols-[32px_1fr] items-center gap-2.5">
      {m.color ? (
        <ColorAvatar color={m.color} initials={initials(m.name)} />
      ) : (
        <span className="grid size-8 place-items-center rounded-lg border border-dashed border-border font-heading text-xs text-muted-foreground">
          {initials(m.name)}
        </span>
      )}
      <div>
        <div className="flex items-baseline gap-2 font-sans text-sm font-medium text-foreground">
          <span className="truncate">{m.name}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase tracking-[0.06em] text-muted-foreground">
            {m.state}
          </span>
        </div>
        <div className="font-sans text-xs leading-[1.45] text-muted-foreground">{m.detail}</div>
      </div>
    </div>
  );
}

function CastTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const selectedId = useProjectStore((s) => s.selectedId);
  const cacheKey = `cast:${activeChapterId ?? ""}:${selectedId ?? ""}`;
  const { data, loading, error, instruction, run } = useAi<CastResult>(
    (ins) => detectCast({ ...buildAiContext(), instruction: ins }),
    cacheKey,
  );
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
            <p className="font-sans text-xs leading-relaxed text-faint">
              Generate reads the scene up to your cursor and lists who's present.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2.5">
                {data.inScene.map((m, i) => (
                  <CastRow key={i} m={m} />
                ))}
              </div>
              {data.offPage.length > 0 ? (
                <>
                  <Separator />
                  <ContextLine>Off-page but referenced</ContextLine>
                  <div className="flex flex-col gap-2.5">
                    {data.offPage.map((m, i) => (
                      <CastRow key={i} m={m} />
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
      <AiComposer
        placeholder="Anything specific about the cast? (optional)"
        loading={loading}
        onSubmit={(t) => run(t || undefined)}
        allowEmpty
      />
    </div>
  );
}

// -- Edit ---------------------------------------------------------------------
const DIFF_TONE: Record<DiffSegment["type"], string> = {
  same: "text-foreground",
  add: "rounded-sm bg-success/15 text-success",
  del: "text-faint line-through",
};

function DiffText({ segments }: { segments: DiffSegment[] }) {
  return (
    <p className="font-serif text-sm leading-relaxed">
      {segments.map((s, i) => (
        <span key={i} className={cn(DIFF_TONE[s.type])}>
          {s.text}
        </span>
      ))}
    </p>
  );
}

function ScopeToggle({
  scope,
  onChange,
  disabled,
}: {
  scope: "block" | "chapter";
  onChange: (s: "block" | "chapter") => void;
  disabled?: boolean;
}) {
  const opts: { id: "block" | "chapter"; label: string }[] = [
    { id: "block", label: "This block" },
    { id: "chapter", label: "Whole chapter" },
  ];
  return (
    <div className="flex gap-1">
      {opts.map((o) => (
        <Button
          key={o.id}
          size="sm"
          variant={scope === o.id ? "default" : "outline"}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className="h-7 flex-1 text-xs"
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function EditTab() {
  const selectedId = useProjectStore((s) => s.selectedId);
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const blocks = useProjectStore((s) => s.blocks);
  const updateBlockText = useProjectStore((s) => s.updateBlockText);
  const patch = useAiCacheStore((s) => s.patch);

  const [scope, setScope] = useState<"block" | "chapter">("block");
  const cacheKey = `edit:${activeChapterId ?? ""}:${scope}:${
    scope === "block" ? selectedId ?? "" : ""
  }`;
  const { data, loading, error, instruction, run } = useAi<BlockEdit[]>(
    (ins) => editBlocks(buildEditRequest(scope, ins ?? "")),
    cacheKey,
  );

  const edits = data ?? [];
  // Resolve each edit against the live block so the diff reflects current text;
  // drop edits whose block has since been removed.
  const live = edits.flatMap((edit) => {
    const block = blocks.find((b) => b.id === edit.blockId);
    return block ? [{ edit, block }] : [];
  });

  const dismiss = (blockId: string) =>
    patch(cacheKey, { data: edits.filter((e) => e.blockId !== blockId) });
  const accept = (e: BlockEdit) => {
    updateBlockText(e.blockId, e.newText);
    dismiss(e.blockId);
  };
  const acceptAll = () => {
    for (const { edit } of live) updateBlockText(edit.blockId, edit.newText);
    patch(cacheKey, { data: [] });
  };
  const rejectAll = () => patch(cacheKey, { data: [] });

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
            <p className="font-sans text-xs leading-relaxed text-faint">
              Describe an edit and pick a scope. Changes come back block by block
              as before/after diffs you can accept or reject.
            </p>
          ) : live.length === 0 ? (
            <p className="font-sans text-xs text-faint">No changes suggested.</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="font-sans text-xs uppercase tracking-[0.08em] text-faint">
                  {live.length} proposed {live.length === 1 ? "edit" : "edits"}
                </span>
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
                <div
                  key={edit.blockId}
                  className="flex flex-col gap-2 rounded-xl border border-ai-edge bg-ai-tint p-3"
                >
                  <span className="font-sans text-xs font-semibold uppercase tracking-[0.06em] text-ai-ink">
                    {block.type}
                  </span>
                  <DiffText segments={diffWords(block.text, edit.newText)} />
                  <div className="flex flex-col gap-0.5 border-t border-ai-edge pt-2">
                    <span className="font-sans text-xs uppercase tracking-[0.08em] text-ai-ink opacity-70">
                      Why
                    </span>
                    <p className="font-sans text-xs leading-snug text-muted-foreground">
                      {edit.reason}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => accept(edit)}>
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => dismiss(edit.blockId)}>
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <AiComposer
        placeholder={
          scope === "block" && !selectedId
            ? "Place your cursor in a block to edit it"
            : "Describe the edit, e.g. fix typos, tighten, make her colder"
        }
        loading={loading}
        onSubmit={(t) => run(t)}
        toolbar={<ScopeToggle scope={scope} onChange={setScope} disabled={loading} />}
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
          void navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
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
  const streamReply = async (history: ChatMessage[]) => {
    if (!activeChapterId) return;
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
        setStreaming(acc);
      }
      setThread(activeChapterId, [...history, { role: "assistant", content: acc }]);
    } catch (e) {
      // Keep whatever streamed before the failure; surface the error alongside it.
      setThread(
        activeChapterId,
        acc ? [...history, { role: "assistant", content: acc }] : history,
      );
      setError(describeAiError(e));
    } finally {
      setStreaming(null);
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
            <p className="font-sans text-xs leading-relaxed text-faint">
              Riff on the scene: ask about motivations, plant a thread, pressure-test a
              beat. The AI reads everything up to your cursor.
            </p>
          ) : null}
          {messages.map((m, i) => (
            <Message key={i} from={m.role}>
              <MessageContent>
                {m.role === "assistant" ? (
                  <MessageResponse>{m.content}</MessageResponse>
                ) : (
                  <span className="whitespace-pre-wrap font-sans text-sm leading-[1.55]">
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
const TABS: { id: AiTab; label: string }[] = [
  { id: "suggest", label: "Suggest" },
  { id: "edit", label: "Edit" },
  { id: "critique", label: "Critique" },
  { id: "brainstorm", label: "Brainstorm" },
  { id: "continuity", label: "Continuity" },
  { id: "cast", label: "Cast" },
];

export function AiPanel() {
  const tab = useViewStore((s) => s.aiTab);
  const setTab = useViewStore((s) => s.setAiTab);

  return (
    <aside
      data-ai-root
      className="flex h-full min-h-0 flex-col border-l border-border bg-card font-sans"
    >
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as AiTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList className="h-auto w-full justify-start gap-0 rounded-none border-b border-border bg-transparent px-2 pt-1.5">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className="rounded-none border-0 border-b-[1.5px] border-transparent bg-transparent px-2.5 py-1.5 text-xs font-medium text-muted-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <CursorAnchor />

        {/* Each tab is a flex column: a scrollable body and a bottom-pinned composer. */}
        <TabsContent value="suggest" className="min-h-0 flex-1">
          <SuggestTab />
        </TabsContent>
        <TabsContent value="edit" className="min-h-0 flex-1">
          <EditTab />
        </TabsContent>
        <TabsContent value="critique" className="min-h-0 flex-1">
          <CritiqueTab />
        </TabsContent>
        <TabsContent value="brainstorm" className="min-h-0 flex-1">
          <BrainstormTab />
        </TabsContent>
        <TabsContent value="continuity" className="min-h-0 flex-1">
          <ContinuityTab />
        </TabsContent>
        <TabsContent value="cast" className="min-h-0 flex-1">
          <CastTab />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
