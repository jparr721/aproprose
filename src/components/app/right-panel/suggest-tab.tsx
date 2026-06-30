// suggest-tab.tsx -- proposes three ways to continue the scene, grounded on the
// prose up to the caret; inserts the chosen one after the selected block.

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
import { useAi } from "@/hooks/use-ai";
import { buildAiContext } from "@/lib/ai/context";
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
} from "@/components/app/right-panel/shared";

export function SuggestTab() {
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
        <div className="flex min-h-full flex-col gap-3.5 p-4">
          <AskedCaption instruction={instruction} />
          {loading ? (
            <LoadingLines rows={5} />
          ) : error ? (
            <AiError error={error} onRetry={() => run(instruction)} />
          ) : !data ? (
            <PanelEmpty icon={IconSparkles} title="Suggest a continuation">
              Generate reads the scene up to your cursor and proposes three ways to continue.
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
        placeholder="e.g. more tension, have her lie"
        loading={loading}
        onSubmit={(t) => run(t || undefined)}
        allowEmpty
        focusSignal={focusTick}
      />
    </div>
  );
}
