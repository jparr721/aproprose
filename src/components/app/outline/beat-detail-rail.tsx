// beat-detail-rail.tsx -- the storyboard's right-hand inspector for the selected
// beat: intention, cast present, lore referenced, and continuity flags.

import { IconX } from "@tabler/icons-react";
import { useProjectStore } from "@/stores/project-store";
import { useOutlineBoardStore } from "@/stores/outline-board-store";
import { findBeat } from "@/lib/outline/model";
import { beatCharacters, SEV_DOT } from "@/lib/outline/beat-signals";
import { InlineEdit } from "@/components/app/outline/inline-edit";
import { BeatTypeBadge } from "@/components/app/outline/beat-type-badge";
import { ColorDot } from "@/components/app/color-dot";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TypographyEyebrow,
  TypographyH4,
  TypographyMuted,
  TypographySmall,
} from "@/components/ui/typography";
import { cn } from "@/lib/utils";

export function BeatDetailRail() {
  const selectedBeatId = useOutlineBoardStore((s) => s.selectedBeatId);
  const outline = useProjectStore((s) => s.meta.outline);
  const roster = useProjectStore((s) => s.meta.characters);
  const lore = useProjectStore((s) => s.meta.lore);
  const editBeat = useProjectStore((s) => s.editBeat);
  const addCharacterToBeat = useProjectStore((s) => s.addCharacterToBeat);
  const removeCharacterFromBeat = useProjectStore((s) => s.removeCharacterFromBeat);
  const addLoreToBeat = useProjectStore((s) => s.addLoreToBeat);
  const removeLoreFromBeat = useProjectStore((s) => s.removeLoreFromBeat);
  const setBeatContinuityFlags = useProjectStore((s) => s.setBeatContinuityFlags);

  const beat = selectedBeatId ? findBeat(outline, selectedBeatId) : null;

  if (!beat) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <TypographyMuted>Select a beat to inspect its cast, lore, and continuity.</TypographyMuted>
      </div>
    );
  }

  const cast = beatCharacters(beat.characterIds, roster);
  const linkableCast = roster.filter((c) => !beat.characterIds.includes(c.id));
  const linkedLore = lore.filter((l) => beat.loreIds.includes(l.id));
  const linkableLore = lore.filter((l) => !beat.loreIds.includes(l.id));

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-col gap-1.5">
        <BeatTypeBadge type={beat.type} />
        <TypographyH4>{beat.title}</TypographyH4>
      </div>

      <section className="flex flex-col gap-1.5">
        <TypographyEyebrow>Intention</TypographyEyebrow>
        <InlineEdit
          value={beat.intention}
          onCommit={(intention) => editBeat(beat.id, { intention })}
          placeholder="What must this beat accomplish?"
          multiline
          className="text-xs leading-snug text-muted-foreground"
        />
      </section>

      <section className="flex flex-col gap-2">
        <TypographyEyebrow>Characters present</TypographyEyebrow>
        <div className="flex flex-wrap items-center gap-1.5">
          {cast.map((c) => (
            <span
              key={c.id}
              className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              <ColorDot color={c.color} />
              {c.name}
              <button
                aria-label={`Unlink ${c.name}`}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => removeCharacterFromBeat(beat.id, c.id)}
              >
                <IconX className="size-3" />
              </button>
            </span>
          ))}
        </div>
        {linkableCast.length > 0 && (
          <Select
            value=""
            onValueChange={(id) => {
              if (id) addCharacterToBeat(beat.id, id);
            }}
          >
            <SelectTrigger size="sm" className="w-fit">
              <SelectValue placeholder="+ Link character" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {linkableCast.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <ColorDot color={c.color} />
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {linkableCast.length === 0 && roster.length > 0 && (
          <TypographyMuted>All characters linked</TypographyMuted>
        )}
        {roster.length === 0 && (
          <TypographyMuted>No characters in roster</TypographyMuted>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <TypographyEyebrow>Lore referenced</TypographyEyebrow>
        <div className="flex flex-wrap items-center gap-1.5">
          {linkedLore.map((l) => (
            <span
              key={l.id}
              className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {l.title}
              <button
                aria-label={`Unlink ${l.title}`}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => removeLoreFromBeat(beat.id, l.id)}
              >
                <IconX className="size-3" />
              </button>
            </span>
          ))}
        </div>
        {linkableLore.length > 0 && (
          <Select
            value=""
            onValueChange={(id) => {
              if (id) addLoreToBeat(beat.id, id);
            }}
          >
            <SelectTrigger size="sm" className="w-fit">
              <SelectValue placeholder="+ Link lore" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {linkableLore.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {linkableLore.length === 0 && lore.length > 0 && (
          <TypographyMuted>All lore linked</TypographyMuted>
        )}
        {lore.length === 0 && (
          <TypographyMuted>No lore entries</TypographyMuted>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <TypographyEyebrow>Continuity</TypographyEyebrow>
          {beat.continuityFlags.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setBeatContinuityFlags(beat.id, [])}
            >
              Clear flags
            </Button>
          )}
        </div>
        {beat.continuityFlags.length === 0 ? (
          <TypographyMuted>No continuity flags</TypographyMuted>
        ) : (
          <div className="flex flex-col gap-1.5">
            {beat.continuityFlags.map((flag, i) => (
              <div
                key={i}
                className="grid grid-cols-[14px_1fr] gap-2 rounded-lg border border-border p-2.5"
              >
                <span className={cn("mt-1 size-2 shrink-0 rounded-full", SEV_DOT[flag.sev])} />
                <div className="flex flex-col gap-0.5">
                  <TypographySmall className="font-semibold text-foreground">
                    {flag.tag}
                  </TypographySmall>
                  <TypographyMuted className="leading-[1.5]">{flag.text}</TypographyMuted>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
