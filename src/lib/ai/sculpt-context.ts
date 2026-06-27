// sculpt-context.ts - build the SculptContext for one act from project state.
//
// Reads the current outline, the act's ordered beats, and the project roster
// (characters + lore) straight from project-store. Pure read; no writes.

import type { SculptContext } from "@/lib/ai/operations";
import type { ActKind } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";

export function buildSculptContext(actKind: ActKind): SculptContext {
  const { meta } = useProjectStore.getState();
  const act = meta.outline.acts.find((a) => a.kind === actKind);
  return {
    actKind,
    premise: meta.outline.premise,
    beats: (act?.beats ?? []).map((b) => ({
      id: b.id,
      title: b.title,
      intention: b.intention,
      type: b.type,
    })),
    characters: meta.characters.map((c) => ({ name: c.name })),
    lore: meta.lore.map((l) => ({ title: l.title })),
  };
}
