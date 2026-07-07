// proposal.ts - the pure reducer behind applyManuscriptProposal.
//
// Folds a reviewed set of BlockChanges over a block list, in change order, so
// each change sees the list exactly as the previous ones left it. Changes whose
// target block no longer exists are skipped AND counted - the caller warns the
// author about vanished targets instead of silently dropping work.

import type { Block, BlockChange } from "@/lib/types";
import { uid } from "@/lib/id";

export interface ApplyProposalOutcome {
  blocks: Block[];
  applied: number;
  skipped: number;
}

/** Pure fold of kept changes over a block list, in change order. Skips (and
 *  counts) changes whose target id no longer exists. resolveSpeakerId maps a
 *  display name to a character id (undefined = leave speaker unset). Inserted
 *  blocks are minted with uid() and dirty: true, raw: "". Consecutive inserts
 *  sharing an afterId apply in READING ORDER: each anchors after the block most
 *  recently inserted for that afterId, so listed order equals final order. Move
 *  clamps toIndex into range. Rewrite sets text + dirty. */
export function applyProposal(
  blocks: Block[],
  changes: BlockChange[],
  resolveSpeakerId: (name: string) => string | undefined,
): ApplyProposalOutcome {
  let cur = blocks;
  let applied = 0;
  let skipped = 0;
  // Original afterId -> id of the block most recently inserted after it. Keeps
  // consecutive same-anchor inserts in reading order instead of reversed.
  const lastInsertFor = new Map<string, string>();

  for (const c of changes) {
    switch (c.kind) {
      case "rewrite": {
        const newText = c.newText;
        const idx = c.blockId === null ? -1 : cur.findIndex((b) => b.id === c.blockId);
        if (idx < 0 || newText === null) {
          skipped += 1;
          break;
        }
        cur = cur.map((b, i) => (i === idx ? { ...b, text: newText, dirty: true } : b));
        applied += 1;
        break;
      }
      case "insert": {
        if (c.newText === null || c.type === null) {
          skipped += 1;
          break;
        }
        const block: Block = {
          id: uid(),
          type: c.type,
          text: c.newText,
          raw: "",
          dirty: true,
        };
        if (c.type === "dialogue") {
          if (c.speaker !== null) {
            const speakerId = resolveSpeakerId(c.speaker);
            if (speakerId !== undefined) block.speaker = speakerId;
          }
          if (c.segments !== undefined && c.segments.length > 0) block.tail = c.segments;
        }
        // Consecutive inserts sharing an afterId apply in reading order: each
        // anchors after the block most recently inserted for that afterId, so
        // the second insert follows the first instead of displacing it. A
        // vanished afterId still inserts at the chapter end: the author kept
        // this change for its content, so landing it somewhere beats dropping it.
        const anchorId = c.afterId === null ? null : lastInsertFor.get(c.afterId) ?? c.afterId;
        const anchor = anchorId === null ? -1 : cur.findIndex((b) => b.id === anchorId);
        const at = anchorId !== null && anchor >= 0 ? anchor + 1 : cur.length;
        if (c.afterId !== null) lastInsertFor.set(c.afterId, block.id);
        const next = [...cur];
        next.splice(at, 0, block);
        cur = next;
        applied += 1;
        break;
      }
      case "remove": {
        const idx = c.blockId === null ? -1 : cur.findIndex((b) => b.id === c.blockId);
        if (idx < 0) {
          skipped += 1;
          break;
        }
        cur = cur.filter((_, i) => i !== idx);
        applied += 1;
        break;
      }
      case "move": {
        const idx = c.blockId === null ? -1 : cur.findIndex((b) => b.id === c.blockId);
        if (idx < 0 || c.toIndex === null) {
          skipped += 1;
          break;
        }
        const next = [...cur];
        const [moved] = next.splice(idx, 1);
        const to = Math.max(0, Math.min(c.toIndex, next.length));
        next.splice(to, 0, moved);
        cur = next;
        applied += 1;
        break;
      }
    }
  }

  return { blocks: cur, applied, skipped };
}
