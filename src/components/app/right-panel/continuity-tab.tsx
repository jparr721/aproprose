// continuity-tab.tsx -- internal-consistency sweep (ok / check / flag) over the
// scene up to the caret or the whole chapter.

import { useState } from "react";
import { IconTimeline } from "@tabler/icons-react";
import { TypographyEyebrow, TypographyMuted } from "@/components/ui/typography";
import { useProjectStore } from "@/stores/project-store";
import { useAi } from "@/hooks/use-ai";
import { buildAnchoredContext, type ReadScope } from "@/lib/ai/context";
import { continuityCheck } from "@/lib/ai/operations";
import type { ContinuityFlag } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  AiComposer,
  AiError,
  AskedCaption,
  LoadingLines,
  PanelEmpty,
  ScopeToggle,
} from "@/components/app/right-panel/shared";

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

export function ContinuityTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const selectedId = useProjectStore((s) => s.selectedId);
  const [scope, setScope] = useState<ReadScope>("cursor");
  // Cursor scope keys on the selection; chapter scope ignores it (whole chapter).
  const cacheKey = `continuity:${activeChapterId ?? ""}:${scope}:${
    scope === "cursor" ? selectedId ?? "" : ""
  }`;
  const { data, loading, error, instruction, run } = useAi<ContinuityFlag[]>(
    (ins) => continuityCheck({ ...buildAnchoredContext(scope), instruction: ins }),
    cacheKey,
    "continuity",
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
            <PanelEmpty icon={IconTimeline} title="Continuity sweep">
              Generate sweeps{" "}
              {scope === "cursor" ? "the scene up to your cursor" : "the whole chapter"} for
              continuity issues.
            </PanelEmpty>
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
        placeholder="e.g. check the timeline, watch eye color"
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
