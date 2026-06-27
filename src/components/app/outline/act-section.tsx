// act-section.tsx — one act on the spine: header + its ordered beats + add.

import { IconPlus } from "@tabler/icons-react";
import { useProjectStore } from "@/stores/project-store";
import { InlineEdit } from "@/components/app/outline/inline-edit";
import { BeatCard } from "@/components/app/outline/beat-card";
import { ACT_ROMAN } from "@/lib/outline/model";
import type { ActKind } from "@/lib/types";

export function ActSection({ actKind }: { actKind: ActKind }) {
  const act = useProjectStore((s) => s.meta.outline.acts.find((a) => a.kind === actKind))!;
  const setActTitle = useProjectStore((s) => s.setActTitle);
  const addBeat = useProjectStore((s) => s.addBeat);

  const lastBeatId = act.beats.length ? act.beats[act.beats.length - 1].id : null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="w-4 font-heading text-[13px] font-bold text-accent-foreground">
          {ACT_ROMAN[actKind]}
        </span>
        <InlineEdit
          value={act.title}
          onCommit={(title) => setActTitle(actKind, title)}
          placeholder="Act title"
          multiline={false}
          className="font-heading text-[13px] font-semibold"
        />
      </div>
      <div className="flex flex-col gap-1.5 border-t border-border p-2">
        {act.beats.map((beat) => (
          <BeatCard key={beat.id} beat={beat} />
        ))}
        <button
          onClick={() => addBeat(actKind, lastBeatId)}
          className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-border py-1.5 font-sans text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <IconPlus className="size-3.5" /> Add beat
        </button>
      </div>
    </div>
  );
}
