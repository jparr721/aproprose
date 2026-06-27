// act-section.tsx — one act on the spine: header + its ordered beats + add.

import { IconPlus } from "@tabler/icons-react";
import { useProjectStore } from "@/stores/project-store";
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { InlineEdit } from "@/components/app/outline/inline-edit";
import { BeatCard } from "@/components/app/outline/beat-card";
import { actPacing } from "@/lib/outline/model";
import type { ActKind } from "@/lib/types";

export function ActSection({ actKind }: { actKind: ActKind }) {
  const outline = useProjectStore((s) => s.meta.outline);
  const project = useProjectStore((s) => s.project);
  const setActTitle = useProjectStore((s) => s.setActTitle);
  const setActSummary = useProjectStore((s) => s.setActSummary);
  const addBeat = useProjectStore((s) => s.addBeat);

  const act = outline.acts.find((a) => a.kind === actKind)!;
  const pacing = actPacing(outline, project?.chapters ?? [])[actKind];

  const lastBeatId = act.beats.length ? act.beats[act.beats.length - 1].id : null;

  return (
    <Card size="sm">
      <CardHeader className="border-b border-border">
        <CardTitle>
          <InlineEdit
            value={act.title}
            onCommit={(title) => setActTitle(actKind, title)}
            placeholder="Act title"
            multiline={false}
          />
        </CardTitle>
        <CardAction>
          <span className="text-xs text-muted-foreground tabular-nums">
            {Math.round(pacing.actualShare * 100)}% / {Math.round(pacing.targetShare * 100)}%
          </span>
        </CardAction>
        <CardDescription>
          <InlineEdit
            value={act.summary}
            onCommit={(summary) => setActSummary(actKind, summary)}
            placeholder="Optional: what this act must accomplish."
            multiline={true}
          />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {act.beats.map((beat) => (
          <BeatCard key={beat.id} beat={beat} />
        ))}
        <button
          onClick={() => addBeat(actKind, lastBeatId)}
          className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <IconPlus className="size-3.5" /> Add beat
        </button>
      </CardContent>
    </Card>
  );
}
