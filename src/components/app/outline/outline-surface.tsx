import { ScrollArea } from "@/components/ui/scroll-area";
import { TypographyEyebrow, TypographyMuted, TypographyP, TypographySmall } from "@/components/ui/typography";
import { CharacterChip } from "@/components/app/outline/character-chip";
import { getChapterOutline } from "@/lib/outline/model";
import { useProjectStore } from "@/stores/project-store";

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
  const characters = useProjectStore((s) => s.meta.characters);

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
        ) : (
          <>
            {SPINE.filter((f) => ch[f.key].trim()).map((f) => (
              <div key={f.key} className="flex flex-col gap-0.5">
                <TypographyEyebrow>{f.label}</TypographyEyebrow>
                <TypographyP className="text-sm leading-normal">{ch[f.key]}</TypographyP>
              </div>
            ))}
            {ch.cards.length > 0 ? (
              <div className="flex flex-col gap-2">
                <TypographyEyebrow>Plot elements</TypographyEyebrow>
                {ch.cards.map((card) => {
                  const cast = card.characterIds
                    .map((id) => characters.find((c) => c.id === id))
                    .filter((c): c is NonNullable<typeof c> => Boolean(c));
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
