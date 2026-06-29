import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { TypographyMutedSpan } from "@/components/ui/typography";
import { CharacterChip } from "@/components/app/outline/character-chip";
import { LoreChip } from "@/components/app/outline/lore-chip";
import { SEV_DOT, beatCharacters, worstSev } from "@/lib/outline/beat-signals";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import { useProjectStore } from "@/stores/project-store";
import { cn } from "@/lib/utils";
import type { Card as CardModel } from "@/lib/types";

interface DndVar extends React.CSSProperties {
  "--dnd-transform": string | undefined;
}

export function BoardCard(props: { card: CardModel; chapterId: string }) {
  const { card, chapterId } = props;
  const characters = useProjectStore((s) => s.meta.characters);
  const lore = useProjectStore((s) => s.meta.lore);
  const openChapter = useOutlineBoardStore((s) => s.openChapter);
  const { setNodeRef, attributes, listeners, transform, isDragging } = useSortable({ id: card.id });

  const cast = beatCharacters(card.characterIds, characters);
  const sev = worstSev(card.continuityFlags);
  const loreEntries = card.loreIds
    .map((id) => lore.find((l) => l.id === id))
    .filter((l): l is NonNullable<typeof l> => Boolean(l));

  return (
    <Card
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => openChapter(chapterId)}
      style={{ "--dnd-transform": CSS.Transform.toString(transform) } as DndVar}
      className={cn(
        "group cursor-pointer gap-0 py-0 transition-colors [transform:var(--dnd-transform,none)] hover:bg-muted/50",
        isDragging && "z-10 opacity-90 shadow-lg",
      )}
    >
      <CardContent className="flex flex-col gap-1.5 p-2">
        <div className="flex items-start gap-1.5">
          {sev ? <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", SEV_DOT[sev])} /> : null}
          <span className="text-sm font-semibold leading-snug text-foreground">{card.title || "Untitled"}</span>
        </div>
        {card.intention.trim() ? (
          <TypographyMutedSpan className="line-clamp-3 text-xs leading-normal">
            {card.intention}
          </TypographyMutedSpan>
        ) : null}
        {cast.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {cast.map((c) => (
              <CharacterChip key={c.id} name={c.name} color={c.color} />
            ))}
          </div>
        ) : null}
        {loreEntries.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {loreEntries.map((l) => (
              <LoreChip key={l.id} title={l.title} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
