// structure.ts - turn a cleaned prose passage into classified blocks.
//
// The deterministic engine behind "Structure into blocks" and the seed the AI
// restructure sends to the model. Mirrors parse.ts's classification, but for the
// CLEANED prose the editor stores (straight quotes "..."), not LaTeX. Fidelity:
// concatenating the produced blocks' text reproduces the input prose, modulo the
// surrounding quote marks a dialogue block strips (the serializer re-adds them).

import type { Block, Character, DialogueSegment } from "@/lib/types";
import { uid } from "@/lib/id";

/** Classify a cleaned prose passage into blocks. Speakers are best-effort. */
export function structurePassage(text: string, cast: Character[]): Block[] {
  return splitParagraphs(text).flatMap((p) => classifyParagraph(p, cast));
}

/** Split on blank lines; trim; drop empties. */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function classifyParagraph(para: string, cast: Character[]): Block[] {
  const firstQuote = para.indexOf('"');
  if (firstQuote === -1) return [narration(para)];
  if (firstQuote > 0) {
    const lead = para.slice(0, firstQuote).trim();
    const rest = para.slice(firstQuote);
    const dialogue = dialogueFrom(rest, cast, lead);
    if (dialogue === null) return [narration(para)];
    const blocks: Block[] = [];
    if (lead.length > 0) blocks.push(narration(lead));
    blocks.push(dialogue);
    return blocks;
  }
  const dialogue = dialogueFrom(para, cast, undefined);
  return dialogue === null ? [narration(para)] : [dialogue];
}

function narration(text: string): Block {
  return { id: uid(), type: "narration", text, raw: "", dirty: true };
}

/** Build a (possibly chained) dialogue block from a paragraph that starts with a
 *  `"` quote. `leadHint` is any narration split off the front, used for speaker
 *  inference (a "Brian said." tag names the speaker of the quote that follows). */
function dialogueFrom(para: string, cast: Character[], leadHint: string | undefined): Block | null {
  const segments: DialogueSegment[] = [];
  const re = /"([^"]*)"/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(para)) !== null) {
    const gap = para.slice(last, m.index).trim();
    if (gap.length > 0) segments.push({ kind: "beat", text: gap });
    const prev = segments[segments.length - 1];
    if (prev !== undefined && prev.kind === "quote") {
      // Two quotes with no beat between them can't be a strict-alternation tail
      // (the parser rejects it -> the block degrades to `latex` on reload).
      // Coalesce them into one quote so structurePassage output always round-trips.
      prev.text = `${prev.text} ${m[1]}`;
    } else {
      segments.push({ kind: "quote", text: m[1] });
    }
    last = m.index + m[0].length;
  }
  if (segments.length === 0 || segments[0].kind !== "quote") return null;
  const trailing = para.slice(last).trim();
  if (trailing.length > 0) segments.push({ kind: "beat", text: trailing });

  const tail = segments.slice(1);
  const beatTexts = tail.filter((s) => s.kind === "beat").map((s) => s.text);
  const speaker = inferSpeaker(leadHint ? [leadHint, ...beatTexts] : beatTexts, cast);

  const block: Block = {
    id: uid(),
    type: "dialogue",
    text: segments[0].text,
    raw: "",
    dirty: true,
    tail: tail.length > 0 ? tail : undefined,
  };
  if (speaker) block.speaker = speaker;
  return block;
}

/** First candidate beat that starts with a cast member's name -> that member's id. */
function inferSpeaker(candidates: string[], cast: Character[]): string | undefined {
  for (const raw of candidates) {
    const lead = raw.trimStart();
    for (const c of cast) {
      const name = c.name.trim();
      if (name.length === 0) continue;
      if (lead.toLowerCase().startsWith(name.toLowerCase())) {
        const after = lead.slice(name.length);
        if (after.length === 0 || /^[\s,.'"]/.test(after)) return c.id;
      }
    }
  }
  return undefined;
}
