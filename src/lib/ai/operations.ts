// operations.ts - retained structured analysis and proposal sanitizers.

import { generateText, Output } from "ai";
import { z } from "zod";

import { authorSystem } from "@/lib/ai/author-preferences";
import {
  CONTINUITY_SYSTEM,
  CRITIQUE_SYSTEM,
} from "@/lib/ai/agent-prompts";
import { renderGrounding } from "@/lib/ai/grounding-render";
import { getModel } from "@/lib/ai/model";
import type {
  BlockType,
  ContinuityFlag,
  CritiqueNote,
  ManuscriptProposal,
  SculptProposal,
} from "@/lib/types";

export interface AiOpOptions {
  signal?: AbortSignal;
}

export interface AnchoredContext {
  chapterTitle?: string;
  cursorSummary?: string;
  characters?: { name: string; role?: string }[];
  instruction?: string;
  structure?: string;
  blocks: { id: string; type: BlockType; text: string }[];
}

function buildAnchoredGrounding(ctx: AnchoredContext): string {
  return renderGrounding({
    chapterTitle: ctx.chapterTitle,
    characters: ctx.characters,
    cursorSummary: ctx.cursorSummary,
    structure: ctx.structure,
    blocks: {
      label: "SCENE BLOCKS (cite these ids in blockIds)",
      items: ctx.blocks,
    },
    instruction:
      ctx.instruction !== undefined
        ? {
            label: "AUTHOR'S REQUEST (follow this)",
            text: ctx.instruction,
          }
        : undefined,
  });
}

const critiqueNoteSchema = z.object({
  kind: z.enum(["strength", "watch", "idea"]),
  tag: z.string(),
  text: z.string(),
  blockIds: z.array(z.string()).nullable(),
});

export const critiqueResultSchema = z.object({
  notes: z.array(critiqueNoteSchema),
});

const continuityFlagSchema = z.object({
  sev: z.enum(["ok", "warn", "flag"]),
  tag: z.string(),
  text: z.string(),
  blockIds: z.array(z.string()).nullable(),
});

export const continuityResultSchema = z.object({
  flags: z.array(continuityFlagSchema),
});

export function sanitizeFindingIds<T extends { blockIds: string[] }>(
  findings: T[],
  offeredIds: string[],
): T[] {
  const known = new Set(offeredIds);
  return findings.map((finding) => ({
    ...finding,
    blockIds: finding.blockIds.filter((id) => known.has(id)),
  }));
}

export async function critique(
  ctx: AnchoredContext,
  opts?: AiOpOptions,
): Promise<CritiqueNote[]> {
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: critiqueResultSchema }),
    system: authorSystem(CRITIQUE_SYSTEM, "voice"),
    prompt: buildAnchoredGrounding(ctx),
    abortSignal: opts?.signal,
  });
  return sanitizeFindingIds(
    output.notes.map((note) => ({
      ...note,
      blockIds: note.blockIds ?? [],
    })),
    ctx.blocks.map((block) => block.id),
  );
}

export async function continuityCheck(
  ctx: AnchoredContext,
  opts?: AiOpOptions,
): Promise<ContinuityFlag[]> {
  const model = await getModel();
  const { output } = await generateText({
    model,
    output: Output.object({ schema: continuityResultSchema }),
    system: authorSystem(CONTINUITY_SYSTEM, "voice"),
    prompt: buildAnchoredGrounding(ctx),
    abortSignal: opts?.signal,
  });
  return sanitizeFindingIds(
    output.flags.map((flag) => ({
      ...flag,
      blockIds: flag.blockIds ?? [],
    })),
    ctx.blocks.map((block) => block.id),
  );
}

export function sanitizeProposal(
  proposal: ManuscriptProposal,
  blocks: { id: string; text: string }[],
  allowedTargetIds: readonly string[] | null,
): ManuscriptProposal {
  const textById = new Map(blocks.map((block) => [block.id, block.text]));
  const allowed =
    allowedTargetIds === null ? null : new Set(allowedTargetIds);
  const permits = (id: string | null): boolean =>
    allowed === null || (id !== null && allowed.has(id));
  const changes = proposal.changes.filter((change) => {
    switch (change.kind) {
      case "rewrite": {
        if (
          change.blockId === null ||
          change.newText === null ||
          !permits(change.blockId)
        ) {
          return false;
        }
        const current = textById.get(change.blockId);
        return (
          current !== undefined &&
          change.newText.trim() !== "" &&
          change.newText.trim() !== current.trim()
        );
      }
      case "insert":
        return (
          change.newText !== null &&
          change.newText.trim() !== "" &&
          change.type !== null &&
          ((change.afterId !== null &&
            textById.has(change.afterId) &&
            permits(change.afterId)) ||
            (change.afterId === null && allowed === null))
        );
      case "remove":
        return (
          change.blockId !== null &&
          textById.has(change.blockId) &&
          permits(change.blockId)
        );
      case "move":
        return (
          change.blockId !== null &&
          textById.has(change.blockId) &&
          change.toIndex !== null &&
          permits(change.blockId)
        );
    }
  });
  return { ...proposal, changes };
}

export function sanitizeSculpt(
  proposal: SculptProposal,
  cardIds: string[],
): SculptProposal {
  const known = new Set(cardIds);
  const changes = proposal.changes.filter((change) => {
    switch (change.kind) {
      case "add":
        return change.cardId === null;
      case "rewrite":
        return (
          change.cardId !== null &&
          known.has(change.cardId) &&
          (change.title !== null || change.intention !== null)
        );
      case "move":
        return (
          change.cardId !== null &&
          known.has(change.cardId) &&
          change.toIndex !== null
        );
      case "remove":
        return change.cardId !== null && known.has(change.cardId);
    }
  });
  return { ...proposal, changes };
}
