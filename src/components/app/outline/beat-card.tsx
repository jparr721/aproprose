// beat-card.tsx — one beat on the spine: title, intention, linked chapter chips.

import { IconDots, IconX } from "@tabler/icons-react";
import { useProjectStore } from "@/stores/project-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InlineEdit } from "@/components/app/outline/inline-edit";
import { BeatTypeBadge } from "@/components/app/outline/beat-type-badge";
import { BEAT_TYPES, BEAT_TYPE_META } from "@/lib/outline/beat-types";
import { beatForChapter, unplacedChapters } from "@/lib/outline/model";
import { cn } from "@/lib/utils";
import type { Beat, BeatType } from "@/lib/types";

export function BeatCard({ beat }: { beat: Beat }) {
  const project = useProjectStore((s) => s.project);
  const outline = useProjectStore((s) => s.meta.outline);
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const editBeat = useProjectStore((s) => s.editBeat);
  const removeBeat = useProjectStore((s) => s.removeBeat);
  const moveBeat = useProjectStore((s) => s.moveBeat);
  const setBeatType = useProjectStore((s) => s.setBeatType);
  const assignChapterToBeat = useProjectStore((s) => s.assignChapterToBeat);
  const unassignChapterFromBeat = useProjectStore((s) => s.unassignChapterFromBeat);
  const selectChapter = useProjectStore((s) => s.selectChapter);

  const chapters = project?.chapters ?? [];
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const active = activeChapterId ? beatForChapter(outline, activeChapterId)?.beat.id === beat.id : false;
  const linkable = unplacedChapters(outline, chapters);

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-background p-2.5",
        active && "ring-1 ring-select-edge",
      )}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <BeatTypeBadge type={beat.type} />
        <InlineEdit
          value={beat.title}
          onCommit={(title) => editBeat(beat.id, { title })}
          placeholder="Beat name"
          multiline={false}
          className="text-xs font-semibold text-foreground"
        />
        <Select
          value={beat.type}
          onValueChange={(v) => setBeatType(beat.id, v as BeatType)}
        >
          <SelectTrigger size="sm" className="ml-auto" aria-label="Beat type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BEAT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {BEAT_TYPE_META[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <IconDots className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => moveBeat(beat.id, -1)}>Move up</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => moveBeat(beat.id, 1)}>Move down</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={() => removeBeat(beat.id)}
            >
              Delete beat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <InlineEdit
        value={beat.intention}
        onCommit={(intention) => editBeat(beat.id, { intention })}
        placeholder="What must this beat accomplish?"
        multiline
        className="mb-1.5 text-xs leading-snug text-muted-foreground"
      />
      <div className="flex flex-wrap gap-1">
        {beat.chapterIds.map((id) => {
          const ch = byId.get(id);
          if (!ch) return null;
          const here = id === activeChapterId;
          return (
            <span
              key={id}
              className={cn(
                "group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                here
                  ? "border-accent-ink/30 bg-accent font-medium text-accent-foreground"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              <button className="hover:underline" onClick={() => void selectChapter(id)}>
                {ch.title}
                {here ? " - here" : ""}
              </button>
              <button
                aria-label={`Unlink ${ch.title}`}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => unassignChapterFromBeat(id)}
              >
                <IconX className="size-3" />
              </button>
            </span>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-faint hover:text-muted-foreground">
            + link chapter
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
            {linkable.length === 0 ? (
              <DropdownMenuItem disabled>All chapters are placed</DropdownMenuItem>
            ) : (
              linkable.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => assignChapterToBeat(c.id, beat.id)}>
                  {c.title}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
