// edit-tab.tsx -- the review surface for manuscript proposals. Model changes
// come back one reviewable card at a time (rewrite diffs, inserts, removals,
// moves) for the author to accept, reject, or refine. Scope routes the op:
// block scope revises the selected prose in place (editBlocks); chapter scope
// may also restructure the chapter (reviseChapter).

import { useState } from "react";
import { toast } from "sonner";
import { IconArrowUp, IconPencil, IconWand } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  TypographyEyebrow,
  TypographyMuted,
  TypographyP,
} from "@/components/ui/typography";
import { selectionTargetIds, useProjectStore } from "@/stores/project-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useAi } from "@/hooks/use-ai";
import { useAiIntent } from "@/hooks/use-ai-intent";
import { aiCacheKey } from "@/lib/ai/cache-key";
import { buildEditRequest, buildRefineRequest } from "@/lib/ai/context";
import { editComposerState } from "@/lib/ai/edit-composer";
import { describeAiError, withAiRetry } from "@/lib/ai/errors";
import { editBlocks, reviseChapter } from "@/lib/ai/operations";
import { diffWords, type DiffSegment } from "@/lib/diff/word-diff";
import type { Block, ManuscriptProposal } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  AiComposer,
  AiError,
  AskedCaption,
  LoadingLines,
  PanelEmpty,
  PanelHint,
  ScopeToggle,
} from "@/components/app/right-panel/shared";

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

/** A proposal change resolved against the live block list, ready to render.
 *  Changes whose target block has vanished drop out of this view; they stay in
 *  the cached proposal and count as "skipped" if the author accepts all. */
type LiveChange =
  | { index: number; kind: "rewrite"; block: Block; newText: string; reason: string }
  | { index: number; kind: "insert"; text: string; anchor: Block | null; reason: string }
  | { index: number; kind: "remove"; block: Block; reason: string }
  | { index: number; kind: "move"; block: Block; toIndex: number; reason: string };

/** Shared chrome for the structural cards: kind eyebrow, body, reason, actions. */
function ChangeCard({
  label,
  reason,
  onAccept,
  onReject,
  children,
}: {
  label: string;
  reason: string;
  onAccept: () => void;
  onReject: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-ai-edge bg-ai-tint p-3">
      <TypographyEyebrow className="text-ai-ink">{label}</TypographyEyebrow>
      {children}
      <div className="flex flex-col gap-0.5 border-t border-ai-edge pt-2">
        <TypographyEyebrow className="text-ai-ink/70">Why</TypographyEyebrow>
        <TypographyMuted className="text-xs">{reason}</TypographyMuted>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={onAccept}>
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={onReject}>
          Reject
        </Button>
      </div>
    </div>
  );
}

/** One proposed rewrite: the before/after diff, its rationale, the accept/
 *  reject/refine actions, and an inline composer for refining *this* proposal
 *  in place (the model reworks the draft, not the original block). Refine
 *  state is per-card and local; the parent owns the cache mutation. */
function RewriteCard({
  block,
  newText,
  reason,
  onAccept,
  onReject,
  onRefine,
}: {
  block: Block;
  newText: string;
  reason: string;
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
      // Clear the box on a real change (the diff now reflects it, ready for
      // another pass); keep the text on a no-op so the author can adjust and retry.
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
      <DiffText segments={diffWords(block.text, newText)} />
      <div className="flex flex-col gap-0.5 border-t border-ai-edge pt-2">
        <TypographyEyebrow className="text-ai-ink/70">Why</TypographyEyebrow>
        <TypographyMuted className="text-xs">{reason}</TypographyMuted>
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

export function EditTab() {
  const selectedId = useProjectStore((s) => s.selectedId);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const blocks = useProjectStore((s) => s.blocks);
  const applyManuscriptProposal = useProjectStore((s) => s.applyManuscriptProposal);
  const setSelection = useProjectStore((s) => s.setSelection);
  const patch = useAiCacheStore((s) => s.patch);

  const [scope, setScope] = useState<"block" | "chapter">("block");
  // P1 seam: composer prefill + focus, driven by cross-tab intents.
  const [prefill, setPrefill] = useState("");
  const [focusKey, setFocusKey] = useState(0);

  // P1 seam: consume a parked edit intent (Send to Edit, brainstorm handoffs).
  useAiIntent("edit", (intent) => {
    setSelection(intent.blockIds ?? []);
    if (intent.scope) setScope(intent.scope === "chapter" ? "chapter" : "block");
    setPrefill(intent.instruction ?? "");
    setFocusKey((k) => k + 1);
  });

  // Identity of the block scope: the same targets buildEditRequest resolves,
  // sorted so the key tracks set membership, not click order, matching its
  // order-independent target list.
  const blockKey = [...selectionTargetIds(selectedIds, selectedId)].sort().join(",");
  const cacheKey = aiCacheKey(
    "edit",
    activeChapterId,
    scope,
    scope === "block" ? blockKey : "",
  );
  // Scope routes the operation: block -> in-place rewrites, chapter -> full
  // structural revision. Both come back as one reviewable ManuscriptProposal.
  const { data, loading, error, instruction, run } = useAi<ManuscriptProposal>(
    (ins) =>
      scope === "chapter"
        ? reviseChapter(buildEditRequest("chapter", ins ?? ""))
        : editBlocks(buildEditRequest("block", ins ?? "")),
    cacheKey,
    "edit",
  );

  // Resolve each cached change against the live block list so cards reflect
  // current text; vanished-target changes drop out of the render.
  const live: LiveChange[] = (data?.changes ?? []).flatMap<LiveChange>((c, index) => {
    switch (c.kind) {
      case "rewrite": {
        const block = blocks.find((b) => b.id === c.blockId);
        return block && c.newText !== null
          ? [{ index, kind: "rewrite" as const, block, newText: c.newText, reason: c.reason }]
          : [];
      }
      case "insert":
        return c.newText !== null
          ? [
              {
                index,
                kind: "insert" as const,
                text: c.newText,
                anchor:
                  c.afterId !== null
                    ? blocks.find((b) => b.id === c.afterId) ?? null
                    : null,
                reason: c.reason,
              },
            ]
          : [];
      case "remove": {
        const block = blocks.find((b) => b.id === c.blockId);
        return block ? [{ index, kind: "remove" as const, block, reason: c.reason }] : [];
      }
      case "move": {
        const block = blocks.find((b) => b.id === c.blockId);
        return block && c.toIndex !== null
          ? [{ index, kind: "move" as const, block, toIndex: c.toIndex, reason: c.reason }]
          : [];
      }
    }
  });

  // Eligible blocks in scope (reusing buildEditRequest's filter); 0 -> skip the
  // call. buildEditRequest requires an active chapter (it stamps chapterId onto
  // the request), so without one nothing is editable and the composer is inert.
  const targetCount = activeChapterId ? buildEditRequest(scope, "").blocks.length : 0;
  // The block-scope button names the editable targets it will act on: "This
  // block" for one, "These N blocks" for a multi-selection. Reuse targetCount
  // under block scope rather than recomputing the same request.
  const blockTargetCount = !activeChapterId
    ? 0
    : scope === "block"
      ? targetCount
      : buildEditRequest("block", "").blocks.length;
  const blockLabel = blockTargetCount > 1 ? `These ${blockTargetCount} blocks` : "This block";

  const hasBlockSelection = selectionTargetIds(selectedIds, selectedId).length > 0;
  const composer = editComposerState({ scope, targetCount, hasBlockSelection });

  // Mutate the cached proposal from its LATEST value (not the render closure) so
  // rapid accept/reject clicks in the same frame can't clobber each other.
  const latest = (): ManuscriptProposal | null =>
    (useAiCacheStore.getState().entries[cacheKey]?.data as ManuscriptProposal | null) ?? null;

  const removeFromCache = (index: number) => {
    const cur = latest();
    if (!cur) return;
    patch(cacheKey, { data: { ...cur, changes: cur.changes.filter((_, i) => i !== index) } });
  };

  const accept = (index: number) => {
    const cur = latest();
    if (!cur) return;
    applyManuscriptProposal(cur, [index]);
    removeFromCache(index);
  };

  // Apply every remaining change as a SINGLE undo step, then clear the set.
  // The reducer skips vanished-target changes; warn with the count so the
  // author knows part of the proposal no longer applied.
  const acceptAll = () => {
    const cur = latest();
    if (!cur || cur.changes.length === 0) return;
    const result = applyManuscriptProposal(
      cur,
      cur.changes.map((_, i) => i),
    );
    if (result.skipped > 0) {
      toast.warning(
        result.skipped === 1
          ? "1 change skipped - its block changed since"
          : `${result.skipped} changes skipped - their blocks changed since`,
      );
    }
    patch(cacheKey, { data: { ...cur, changes: [] } });
  };

  const rejectAll = () => {
    const cur = latest();
    if (!cur) return;
    patch(cacheKey, { data: { ...cur, changes: [] } });
  };

  // Refine one proposed rewrite in place: re-run the model with the PROPOSAL as
  // the base text (not the block's stored text) so the author iterates on a
  // draft they like. Rewrite-only: structural changes are accepted or rejected.
  // Direct op call (not through useAi), so it wraps its own retry.
  const refine = async (
    index: number,
    block: Block,
    baseText: string,
    instructionText: string,
  ): Promise<boolean> => {
    const refined = await withAiRetry(() =>
      editBlocks(buildRefineRequest({ id: block.id, type: block.type }, baseText, instructionText)),
    );
    const next = refined.changes.find((c) => c.kind === "rewrite" && c.newText !== null);
    if (!next) return false; // no-op refine: keep the existing proposal as-is
    const cur = latest();
    if (!cur) return false;
    patch(cacheKey, {
      data: { ...cur, changes: cur.changes.map((c, i) => (i === index ? next : c)) },
    });
    return true;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col gap-3 p-4">
          <AskedCaption instruction={instruction} />
          {loading ? (
            <LoadingLines rows={5} />
          ) : error ? (
            <AiError error={error} onRetry={() => run(instruction)} />
          ) : !data ? (
            <PanelEmpty icon={IconPencil} title="Describe an edit">
              Describe an edit and pick a scope. Block scope revises the selected prose in
              place; chapter scope may also insert, remove, and reorder blocks. Review each
              change before it lands.
            </PanelEmpty>
          ) : live.length === 0 ? (
            <PanelHint>No changes suggested.</PanelHint>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <TypographyEyebrow>
                  {live.length} proposed {live.length === 1 ? "change" : "changes"}
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
              {live.map((item) => {
                if (item.kind === "rewrite") {
                  return (
                    <RewriteCard
                      key={`rw-${item.block.id}`}
                      block={item.block}
                      newText={item.newText}
                      reason={item.reason}
                      onAccept={() => accept(item.index)}
                      onReject={() => removeFromCache(item.index)}
                      onRefine={(ins) => refine(item.index, item.block, item.newText, ins)}
                    />
                  );
                }
                if (item.kind === "insert") {
                  return (
                    <ChangeCard
                      key={`ins-${item.index}`}
                      label="Insert"
                      reason={item.reason}
                      onAccept={() => accept(item.index)}
                      onReject={() => removeFromCache(item.index)}
                    >
                      <TypographyP className="mt-0 text-sm">{item.text}</TypographyP>
                      <TypographyMuted className="line-clamp-1 text-xs">
                        {item.anchor ? `After: ${item.anchor.text}` : "At chapter end"}
                      </TypographyMuted>
                    </ChangeCard>
                  );
                }
                if (item.kind === "remove") {
                  return (
                    <ChangeCard
                      key={`rm-${item.block.id}`}
                      label="Remove"
                      reason={item.reason}
                      onAccept={() => accept(item.index)}
                      onReject={() => removeFromCache(item.index)}
                    >
                      <TypographyP className="mt-0 text-sm text-muted-foreground line-through">
                        {item.block.text}
                      </TypographyP>
                    </ChangeCard>
                  );
                }
                return (
                  <ChangeCard
                    key={`mv-${item.block.id}`}
                    label="Move"
                    reason={item.reason}
                    onAccept={() => accept(item.index)}
                    onReject={() => removeFromCache(item.index)}
                  >
                    <TypographyP className="mt-0 line-clamp-2 text-sm">
                      {item.block.text}
                    </TypographyP>
                    <TypographyMuted className="text-xs">
                      Move to position {item.toIndex + 1}
                    </TypographyMuted>
                  </ChangeCard>
                );
              })}
            </>
          )}
        </div>
      </div>
      <AiComposer
        placeholder={composer.placeholder}
        disabled={composer.disabled}
        loading={loading}
        anchorMode={scope === "chapter" ? "chapter" : "cursor"}
        prefill={prefill}
        focusKey={focusKey}
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
