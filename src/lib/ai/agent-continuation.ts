import { findBridgeSuccessor } from "@/lib/ai/agent-context";
import { SUGGEST_DIRECTIVE } from "@/lib/ai/agent-prompts";
import type { AgentIntent } from "@/lib/ai/agent-types";
import type { Block } from "@/lib/types";

export function buildContinuationIntent(
  chapterId: string,
  blocks: Block[],
  contextBlockIds: string[],
): Extract<AgentIntent, { kind: "run" }> {
  const prose = blocks.filter((block) => block.type === "narration" || block.type === "dialogue");
  const selected = prose.filter((block) => contextBlockIds.includes(block.id));
  const anchor = selected.at(-1) ?? prose.at(-1);
  const anchorBlockId = anchor === undefined ? null : anchor.id;
  return {
    kind: "run",
    mode: "writing",
    text: SUGGEST_DIRECTIVE,
    refs: contextBlockIds.map((blockId) => ({ kind: "block", chapterId, blockId })),
    task: {
      kind: "bridge",
      chapterId,
      anchorBlockId,
      successorBlockId: anchorBlockId === null ? null : findBridgeSuccessor(blocks, anchorBlockId),
    },
  };
}
