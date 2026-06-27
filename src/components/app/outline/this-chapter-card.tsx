// this-chapter-card.tsx -- the active chapter's Goal/Conflict/Turn + its beat.

import { useProjectStore } from "@/stores/project-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TypographyEyebrow } from "@/components/ui/typography";
import { InlineEdit } from "@/components/app/outline/inline-edit";
import { ACT_ROMAN, beatForChapter } from "@/lib/outline/model";
import { cn } from "@/lib/utils";

const FIELDS: { key: "goal" | "conflict" | "turn"; label: string; dot: string; placeholder: string }[] = [
  { key: "goal", label: "Goal", dot: "bg-success", placeholder: "What does this chapter set up - what does the POV character want going in?" },
  { key: "conflict", label: "Conflict", dot: "bg-warning", placeholder: "What obstacle or question creates the tension?" },
  { key: "turn", label: "Turn", dot: "bg-muted-foreground/40", placeholder: "How does it resolve, or what hook launches the next chapter?" },
];

export function ThisChapterCard() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const project = useProjectStore((s) => s.project);
  const outline = useProjectStore((s) => s.meta.outline);
  const chapterBeats = useProjectStore((s) => s.meta.chapterBeats);
  const setChapterBeat = useProjectStore((s) => s.setChapterBeat);
  const assignChapterToBeat = useProjectStore((s) => s.assignChapterToBeat);

  if (!activeChapterId || !project) return null;
  const chapter = project.chapters.find((c) => c.id === activeChapterId);
  if (!chapter) return null;

  const cb = chapterBeats[activeChapterId] ?? { goal: "", conflict: "", turn: "" };
  const linked = beatForChapter(outline, activeChapterId);

  return (
    <div className="overflow-hidden rounded-xl border-[1.5px] border-select-edge bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-select-edge/10 px-3 py-2">
        <TypographyEyebrow className="text-select-edge">
          This chapter
        </TypographyEyebrow>
        <span className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "rounded-full border px-2 py-0.5 font-sans text-[10.5px] font-medium",
                linked
                  ? "border-accent-ink/30 bg-accent text-accent-foreground"
                  : "border-dashed border-border text-muted-foreground",
              )}
            >
              {linked
                ? `${linked.beat.title} - Act ${ACT_ROMAN[linked.act.kind]}`
                : "Unassigned"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-auto">
              {outline.acts.map((act) => (
                <div key={act.kind}>
                  <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Act {ACT_ROMAN[act.kind]} - {act.title}
                  </DropdownMenuLabel>
                  {act.beats.map((beat) => (
                    <DropdownMenuItem
                      key={beat.id}
                      onSelect={() => assignChapterToBeat(activeChapterId, beat.id)}
                    >
                      {beat.title}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <div className="flex flex-col gap-2.5 px-3 py-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", f.dot)} />
              <TypographyEyebrow className="text-muted-foreground">{f.label}</TypographyEyebrow>
            </span>
            <InlineEdit
              value={cb[f.key]}
              onCommit={(next) => setChapterBeat(activeChapterId, { [f.key]: next })}
              placeholder={f.placeholder}
              multiline={true}
              className="font-serif text-[13px] leading-snug text-foreground/80"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
