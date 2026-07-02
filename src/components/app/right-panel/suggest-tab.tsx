// suggest-tab.tsx -- proposes three ways to continue the scene, grounded on the
// prose up to the caret (or the whole chapter); inserts the chosen one after the
// block the suggestion was generated against.

import { useEffect, useState } from "react";
import { IconArrowRight, IconSparkles } from "@tabler/icons-react";
import { ButtonGroup } from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  TypographyEyebrow,
  TypographyMuted,
  TypographyP,
} from "@/components/ui/typography";
import { scrollSelectedIntoView } from "@/components/app/editor";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useAi } from "@/hooks/use-ai";
import { aiCacheKey } from "@/lib/ai/cache-key";
import { buildSuggestContext, type ReadScope } from "@/lib/ai/context";
import { suggestContinuation } from "@/lib/ai/operations";
import type { SuggestResult, Suggestion } from "@/lib/types";
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

export function SuggestTab() {
  const focusTick = useViewStore((s) => s.suggestFocusTick);
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const insertAfter = useProjectStore((s) => s.insertAfter);
  const selectedId = useProjectStore((s) => s.selectedId);
  const blocks = useProjectStore((s) => s.blocks);
  const characters = useProjectStore((s) => s.meta.characters);

  const [scope, setScope] = useState<ReadScope>("cursor");
  // Cursor scope keys on the selection; chapter scope reads every block (but still
  // inserts after the caret), so it ignores the selection in the cache key.
  const cacheKey = aiCacheKey(
    "suggest",
    activeChapterId,
    scope,
    scope === "cursor" ? selectedId ?? "" : "",
  );
  const patch = useAiCacheStore((s) => s.patch);
  const { data, loading, error, instruction, run } = useAi<SuggestResult>(
    (ins) => suggestContinuation({ ...buildSuggestContext(scope), instruction: ins }),
    cacheKey,
    "suggest",
  );

  // The block this cached suggestion was generated to follow. Chapter scope keeps a
  // suggestion across cursor moves, so the anchor (where it inserts, what the pill
  // names) stays pinned here instead of drifting to the live caret. If that block
  // was since deleted the frozen id no longer resolves, so fall back to the live
  // caret rather than handing a dead id to insertAfter (which would prepend at the
  // chapter top) or to the pill (which would claim "end of the chapter").
  const anchorId = useAiCacheStore((s) => s.entries[cacheKey]?.anchorId);
  const anchorBlockId =
    anchorId != null && blocks.some((b) => b.id === anchorId) ? anchorId : selectedId;

  // Freeze the anchor to the caret at generation time, then run. Used for both the
  // first run (composer submit) and every regenerate (Try again / retry).
  const generate = (ins?: string) => {
    patch(cacheKey, { anchorId: selectedId ?? undefined });
    run(ins);
  };

  const [variant, setVariant] = useState(0);
  useEffect(() => setVariant(0), [data]);

  const insert = (s: Suggestion) => {
    const speakerId =
      s.type === "dialogue" && s.speaker
        ? characters.find((c) => c.name.toLowerCase() === s.speaker?.toLowerCase())?.id
        : undefined;
    insertAfter(anchorBlockId, { type: s.type, text: s.text, speaker: speakerId });
    requestAnimationFrame(() => scrollSelectedIntoView());
  };

  const v =
    data && data.suggestions.length > 0
      ? data.suggestions[Math.min(variant, data.suggestions.length - 1)]
      : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col gap-3.5 p-4">
          <AskedCaption instruction={instruction} />
          {loading ? (
            <LoadingLines rows={5} />
          ) : error ? (
            <AiError error={error} onRetry={() => generate(instruction)} />
          ) : !data ? (
            <PanelEmpty icon={IconSparkles} title="Suggest a continuation">
              Generate reads{" "}
              {scope === "cursor" ? "the scene up to your cursor" : "the whole chapter"} and
              proposes three ways to continue.
            </PanelEmpty>
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
                  <Button size="sm" variant="outline" onClick={() => generate(instruction)}>
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
        placeholder="e.g. more tension, have her lie"
        loading={loading}
        onSubmit={(t) => generate(t || undefined)}
        allowEmpty
        focusSignal={focusTick}
        anchorMode={scope === "cursor" ? "cursor" : "chapter-insert"}
        anchorId={anchorBlockId ?? undefined}
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
