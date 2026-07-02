// critique-tab.tsx -- craft notes (strengths / things to watch / ideas) on the
// scene up to the caret or the whole chapter.

import { useState } from "react";
import { IconNotes } from "@tabler/icons-react";
import { TypographyEyebrow, TypographyMuted } from "@/components/ui/typography";
import { useProjectStore } from "@/stores/project-store";
import { useAi } from "@/hooks/use-ai";
import { buildAnchoredContext, type ReadScope } from "@/lib/ai/context";
import { critique } from "@/lib/ai/operations";
import type { CritiqueNote } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  AiComposer,
  AiError,
  AskedCaption,
  LoadingLines,
  PanelEmpty,
  ScopeToggle,
} from "@/components/app/right-panel/shared";

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

export function CritiqueTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const selectedId = useProjectStore((s) => s.selectedId);
  const [scope, setScope] = useState<ReadScope>("cursor");
  // Cursor scope keys on the selection; chapter scope ignores it (whole chapter).
  const cacheKey = `critique:${activeChapterId ?? ""}:${scope}:${
    scope === "cursor" ? selectedId ?? "" : ""
  }`;
  const { data, loading, error, instruction, run } = useAi<CritiqueNote[]>(
    (ins) => critique({ ...buildAnchoredContext(scope), instruction: ins }),
    cacheKey,
    "critique",
  );
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col gap-3 p-4">
          <AskedCaption instruction={instruction} />
          {loading ? (
            <LoadingLines rows={6} />
          ) : error ? (
            <AiError error={error} onRetry={() => run(instruction)} />
          ) : !data ? (
            <PanelEmpty icon={IconNotes} title="Critique this scene">
              Generate reads{" "}
              {scope === "cursor" ? "the scene up to your cursor" : "the whole chapter"} and
              returns craft notes.
            </PanelEmpty>
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
        placeholder="e.g. tighten the pacing, sharpen the dialogue"
        loading={loading}
        onSubmit={(t) => run(t || undefined)}
        allowEmpty
        anchorMode={scope === "chapter" ? "chapter" : "cursor"}
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
