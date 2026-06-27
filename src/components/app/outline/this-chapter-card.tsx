// this-chapter-card.tsx -- the active chapter's Goal/Conflict/Turn + its beat.

import { useProjectStore } from "@/stores/project-store";
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TypographyEyebrow } from "@/components/ui/typography";
import { InlineEdit } from "@/components/app/outline/inline-edit";
import { beatForChapter } from "@/lib/outline/model";

const UNASSIGNED = "__unassigned__";

const FIELDS: { key: "goal" | "conflict" | "turn"; label: string; placeholder: string }[] = [
  {
    key: "goal",
    label: "Goal",
    placeholder: "What does this chapter set up - what does the POV character want going in?",
  },
  {
    key: "conflict",
    label: "Conflict",
    placeholder: "What obstacle or question creates the tension?",
  },
  {
    key: "turn",
    label: "Turn",
    placeholder: "How does it resolve, or what hook launches the next chapter?",
  },
];

export function ThisChapterCard() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const project = useProjectStore((s) => s.project);
  const outline = useProjectStore((s) => s.meta.outline);
  const chapterBeats = useProjectStore((s) => s.meta.chapterBeats);
  const setChapterBeat = useProjectStore((s) => s.setChapterBeat);
  const assignChapterToBeat = useProjectStore((s) => s.assignChapterToBeat);
  const unassignChapterFromBeat = useProjectStore((s) => s.unassignChapterFromBeat);

  if (!activeChapterId || !project) return null;
  const chapter = project.chapters.find((c) => c.id === activeChapterId);
  if (!chapter) return null;

  const cb = chapterBeats[activeChapterId] ?? { goal: "", conflict: "", turn: "" };
  const linked = beatForChapter(outline, activeChapterId);

  const onBeatChange = (value: string) => {
    if (value === UNASSIGNED) unassignChapterFromBeat(activeChapterId);
    else assignChapterToBeat(activeChapterId, value);
  };

  return (
    <Card size="sm">
      <CardHeader className="border-b border-border">
        <CardTitle>This chapter</CardTitle>
        <CardAction>
          <Select value={linked?.beat.id ?? UNASSIGNED} onValueChange={onBeatChange}>
            <SelectTrigger size="sm">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {outline.acts.map((act) => (
                <SelectGroup key={act.kind}>
                  <SelectLabel>{act.title}</SelectLabel>
                  {act.beats.map((beat) => (
                    <SelectItem key={beat.id} value={beat.id}>
                      {beat.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <TypographyEyebrow>{f.label}</TypographyEyebrow>
            <InlineEdit
              value={cb[f.key]}
              onCommit={(next) => setChapterBeat(activeChapterId, { [f.key]: next })}
              placeholder={f.placeholder}
              multiline={true}
              className="text-sm leading-snug"
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
