import { IconLayoutList } from "@tabler/icons-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { TypographyEyebrow, TypographyMuted, TypographyP, TypographySmall } from "@/components/ui/typography";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { CharacterChip } from "@/components/app/outline/character-chip";
import { LoreChip } from "@/components/app/outline/lore-chip";
import { useLoreSheetStore } from "@/stores/lore-sheet-store";
import { beatCharacters } from "@/lib/outline/beat-signals";
import { getChapterOutline } from "@/lib/outline/model";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
const SPINE: { key: "premise" | "goal" | "conflict" | "turn"; label: string }[] = [
  { key: "premise", label: "Premise" },
  { key: "goal", label: "Goal" },
  { key: "conflict", label: "Conflict" },
  { key: "turn", label: "Turn" },
];

/** Read-only reference of the chapter the writer is currently in. Editing happens
 *  on the Storyboard / chapter subview, not here. */
export function OutlineSurface() {
  const premise = useProjectStore((s) => s.meta.outline.premise);
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const ch = useProjectStore((s) => (activeChapterId ? getChapterOutline(s.meta.chapters, activeChapterId) : null));
  const chapterRef = useProjectStore((s) =>
    activeChapterId ? s.project?.chapters.find((c) => c.id === activeChapterId) ?? null : null,
  );
  const characters = useProjectStore((s) => s.meta.characters);
  const toggleOutline = useViewStore((s) => s.toggleOutline);
  const lore = useProjectStore((s) => s.meta.lore);
  const openLoreSheet = useLoreSheetStore((s) => s.open);

  const chapterCast = ch ? beatCharacters(ch.characterIds, characters) : [];
  const hasOutline = ch
    ? SPINE.some((f) => ch[f.key].trim()) || ch.cards.length > 0 || chapterCast.length > 0
    : false;

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-3.5">
        {premise.trim() ? (
          <div className="flex flex-col gap-1">
            <TypographyEyebrow>Logline</TypographyEyebrow>
            <TypographyMuted className="text-sm leading-normal">{premise}</TypographyMuted>
          </div>
        ) : null}

        {!ch ? (
          <TypographyMuted className="text-sm">Open a chapter to see its plan.</TypographyMuted>
        ) : !hasOutline ? (
          <Empty className="min-h-[200px] border-none">
            <EmptyHeader>
              <EmptyTitle>No outline yet</EmptyTitle>
              <EmptyDescription>
                Fill in the story spine and plot cards on the outline board to see your chapter plan here.
              </EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" size="sm" onClick={() => toggleOutline()}>
              <IconLayoutList className="size-4" /> Open outline
            </Button>
          </Empty>
        ) : (
          <>
            {chapterCast.length > 0 ? (
              <div className="flex flex-col gap-1">
                <TypographyEyebrow>Characters</TypographyEyebrow>
                <div className="flex flex-wrap gap-1">
                  {chapterCast.map((c) => <CharacterChip key={c.id} name={c.name} color={c.color} />)}
                </div>
              </div>
            ) : null}
            {SPINE.filter((f) => ch[f.key].trim()).map((f) => (
              <div key={f.key} className="flex flex-col gap-0.5">
                <TypographyEyebrow>{f.label}</TypographyEyebrow>
                <TypographyP className="text-sm leading-normal">{ch[f.key]}</TypographyP>
              </div>
            ))}
            {ch.cards.length > 0 ? (
              <div className="flex flex-col gap-2">
                <TypographyEyebrow>
                  Plot elements
                  {chapterRef ? ` — ${chapterRef.title || chapterRef.label}` : ""}
                </TypographyEyebrow>
                {ch.cards.map((card) => {
                  const cast = card.characterIds
                    .map((id) => characters.find((c) => c.id === id))
                    .filter((c): c is NonNullable<typeof c> => Boolean(c));
                  const loreEntries = card.loreIds
                    .map((id) => lore.find((l) => l.id === id))
                    .filter((l): l is NonNullable<typeof l> => Boolean(l));
                  return (
                    <div key={card.id} className="flex flex-col gap-1 rounded-lg border border-border p-2.5">
                      <TypographySmall className="font-semibold text-foreground">{card.title || "Untitled"}</TypographySmall>
                      {card.intention.trim() ? (
                        <TypographyMuted className="text-xs leading-normal">{card.intention}</TypographyMuted>
                      ) : null}
                      {cast.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {cast.map((c) => <CharacterChip key={c.id} name={c.name} color={c.color} />)}
                        </div>
                      ) : null}
                      {loreEntries.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {loreEntries.map((l) => (
                            <LoreChip
                              key={l.id}
                              title={l.title}
                              onClick={() => openLoreSheet(l.id)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </div>
    </ScrollArea>
  );
}
