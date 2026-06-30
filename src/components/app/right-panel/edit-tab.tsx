// edit-tab.tsx -- model revisions returned block by block as before/after diffs the
// author can accept, reject, or refine in place. Scope: selected block(s) or chapter.

import { useState } from "react";
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
import { buildEditRequest, buildRefineRequest } from "@/lib/ai/context";
import { editComposerState } from "@/lib/ai/edit-composer";
import { describeAiError } from "@/lib/ai/errors";
import { editBlocks } from "@/lib/ai/operations";
import { diffWords, type DiffSegment } from "@/lib/diff/word-diff";
import type { Block, BlockEdit } from "@/lib/types";
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

export function EditTab() {
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
        <div className="flex min-h-full flex-col gap-3 p-4">
          <AskedCaption instruction={instruction} />
          {loading ? (
            <LoadingLines rows={5} />
          ) : error ? (
            <AiError error={error} onRetry={() => run(instruction)} />
          ) : !data ? (
            <PanelEmpty icon={IconPencil} title="Describe an edit">
              Describe an edit and pick a scope. Changes come back block by block as before/after
              diffs you can accept or reject.
            </PanelEmpty>
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
        anchorMode={scope === "chapter" ? "chapter" : "cursor"}
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
