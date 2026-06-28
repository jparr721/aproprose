import { IconChevronRight, IconLayoutKanban, IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { TypographyEyebrow, TypographyMuted } from "@/components/ui/typography";
import { CharacterChip } from "@/components/app/outline/character-chip";
import { BEAT_TYPE_LABEL, BEAT_TYPE_ORDER } from "@/components/app/outline/plot-point-badge";
import { ACT_ORDER, ACT_TITLES, getChapterOutline } from "@/lib/outline/model";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import { useProjectStore } from "@/stores/project-store";
import type { ActKind, BeatType } from "@/lib/types";

const NONE = "__none__";

const SPINE: { key: "premise" | "goal" | "conflict" | "turn"; label: string; placeholder: string }[] = [
  { key: "premise", label: "Premise", placeholder: "What is this chapter about, in a sentence or two?" },
  { key: "goal", label: "Goal", placeholder: "What does this chapter set up - what does the POV character want going in?" },
  { key: "conflict", label: "Conflict", placeholder: "What obstacle or question creates the tension?" },
  { key: "turn", label: "Turn", placeholder: "How does it resolve, or what hook launches the next chapter?" },
];

export function ChapterSubview() {
  const chapterId = useOutlineBoardStore((s) => s.openChapterId);
  const closeChapter = useOutlineBoardStore((s) => s.closeChapter);
  const chapterRef = useProjectStore((s) => s.project?.chapters.find((c) => c.id === chapterId));
  const ch = useProjectStore((s) => (chapterId ? getChapterOutline(s.meta.chapters, chapterId) : null));
  const characters = useProjectStore((s) => s.meta.characters);
  const renameChapter = useProjectStore((s) => s.renameChapter);
  const setChapterField = useProjectStore((s) => s.setChapterField);
  const setChapterAct = useProjectStore((s) => s.setChapterAct);
  const setChapterPlotPoint = useProjectStore((s) => s.setChapterPlotPoint);
  const addCard = useProjectStore((s) => s.addCard);
  const editCard = useProjectStore((s) => s.editCard);
  const removeCard = useProjectStore((s) => s.removeCard);
  const removeCharacterFromCard = useProjectStore((s) => s.removeCharacterFromCard);

  if (!chapterId || !ch || !chapterRef) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-xs text-muted-foreground">
        <button type="button" onClick={closeChapter} className="flex items-center gap-1.5 hover:text-foreground">
          <IconLayoutKanban className="size-3.5" /> Storyboard
        </button>
        <IconChevronRight className="size-3 text-faint" />
        <span className="text-foreground">{chapterRef.title}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-5 px-6 py-6">
          <Input
            value={chapterRef.title}
            onChange={(e) => void renameChapter(chapterRef.id, e.target.value)}
            className="h-auto border-none p-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
          />

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <TypographyEyebrow>Act</TypographyEyebrow>
              <Select
                value={ch.act ?? NONE}
                onValueChange={(v) => setChapterAct(chapterId, v === NONE ? null : (v as ActKind))}
              >
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {ACT_ORDER.map((a) => (
                    <SelectItem key={a} value={a}>{ACT_TITLES[a]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <TypographyEyebrow>Structural beat</TypographyEyebrow>
              <Select
                value={ch.plotPoint ?? NONE}
                onValueChange={(v) => setChapterPlotPoint(chapterId, v === NONE ? null : (v as BeatType))}
              >
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {BEAT_TYPE_ORDER.map((t) => (
                    <SelectItem key={t} value={t}>{BEAT_TYPE_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <span className="ml-auto text-xs text-faint">{chapterRef.wordCount.toLocaleString()} words</span>
          </div>

          <div className="flex flex-col gap-4">
            {SPINE.map((f) => (
              <label key={f.key} className="flex flex-col gap-1.5">
                <TypographyEyebrow>{f.label}</TypographyEyebrow>
                <Textarea
                  value={ch[f.key]}
                  onChange={(e) => setChapterField(chapterId, { [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  rows={f.key === "conflict" ? 3 : 2}
                  className="resize-y"
                />
              </label>
            ))}
          </div>

          <div className="flex items-baseline gap-2 border-t border-border pt-4">
            <TypographyEyebrow>Plot elements</TypographyEyebrow>
            <TypographyMuted className="text-xs">the pieces of this chapter</TypographyMuted>
          </div>

          <div className="flex flex-col gap-2.5">
            {ch.cards.map((card) => {
              const cast = card.characterIds
                .map((id) => characters.find((c) => c.id === id))
                .filter((c): c is NonNullable<typeof c> => Boolean(c));
              return (
                <Card key={card.id}>
                  <CardContent className="flex flex-col gap-2 p-3">
                    <Input
                      value={card.title}
                      onChange={(e) => editCard(chapterId, card.id, { title: e.target.value })}
                      placeholder="Card title"
                      className="h-auto border-none p-0 font-semibold shadow-none focus-visible:ring-0"
                    />
                    <Textarea
                      value={card.intention}
                      onChange={(e) => editCard(chapterId, card.id, { intention: e.target.value })}
                      placeholder="What does this beat accomplish?"
                      rows={2}
                      className="resize-y border-none p-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      {cast.map((c) => (
                        <CharacterChip
                          key={c.id}
                          name={c.name}
                          color={c.color}
                          onRemove={() => removeCharacterFromCard(chapterId, card.id, c.id)}
                        />
                      ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-muted-foreground"
                        onClick={() => removeCard(chapterId, card.id)}
                      >
                        Remove card
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            <Button
              variant="outline"
              className="justify-start border-dashed text-muted-foreground"
              onClick={() => addCard(chapterId)}
            >
              <IconPlus className="size-4" /> Add card
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
