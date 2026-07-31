import type { AgentMode, AgentTask } from "@/lib/ai/agent-types";
import {
  renderEditingPreference,
  renderVoicePreference,
} from "@/lib/ai/author-preferences";

export const WRITING_MODE_MARKER = "APROPROSE WRITING MODE";
export const EDIT_MODE_MARKER = "APROPROSE EDIT MODE";

const BASE_AGENT_INSTRUCTIONS = `You are the agent inside aproprose. Work only on the open project represented by the supplied conversation, immutable attachments, and tools.

Use tools to inspect source before making source-specific claims. Show useful conclusions in concise prose. Never expose chain-of-thought or hidden reasoning.

When the author requests manuscript or outline changes, stage one complete proposal for review. Never claim a project write occurred. The author alone applies reviewed changes through the proposal tray.

Read and preserve existing later prose. Use exact source ids returned by tools. A pending proposal is a complete workspace: read it before a follow-up, then stage one complete replacement.`;

const WRITING_MODE_INSTRUCTIONS = `${WRITING_MODE_MARKER}

Favor continuation, scene expansion, exploration, and bridges that preserve the author's voice and later text. Make the minimum insertion needed to connect existing boundaries.`;

const EDIT_MODE_INSTRUCTIONS = `${EDIT_MODE_MARKER}

Favor conservative revision, critique, continuity, cleanup, and restructuring. Change as little as possible to satisfy the request and keep every write reviewable.`;

function taskInstructions(task: AgentTask): string {
  if (task.kind === "bridge") {
    const rightBoundary =
      task.successorBlockId === null
        ? "There is no later prose boundary; append after the anchor."
        : `Preserve successor prose block ${task.successorBlockId} and every later block.`;
    return `FROZEN TASK: bridge after ${task.anchorBlockId}. ${rightBoundary}`;
  }
  if (task.kind === "selected-block-edit") {
    return `FROZEN TASK: ${task.operation} only blocks ${task.blockIds.join(", ")} in chapter ${task.chapterId}.`;
  }
  if (task.kind === "chapter-analysis") {
    return `FROZEN TASK: read-only ${task.analysis} for chapter ${task.chapterId}.`;
  }
  if (task.kind === "outline-sculpt") {
    return `FROZEN TASK: stage outline changes only for chapter ${task.chapterId}.`;
  }
  if (task.kind === "proposal-follow-up") {
    return `FROZEN TASK: replace pending proposal ${task.proposalId} completely.`;
  }
  return task.targetChapterId === null
    ? "FROZEN TASK: conversation with no write target."
    : `FROZEN TASK: conversation may stage changes only for chapter ${task.targetChapterId}.`;
}

export function buildAgentInstructions(args: {
  mode: AgentMode;
  task: AgentTask;
  styleGuide: string;
  editingRules: string;
}): string {
  const modeInstructions =
    args.mode === "writing"
      ? WRITING_MODE_INSTRUCTIONS
      : EDIT_MODE_INSTRUCTIONS;
  return [
    BASE_AGENT_INSTRUCTIONS,
    modeInstructions,
    taskInstructions(args.task),
    renderVoicePreference(args.styleGuide),
    renderEditingPreference(args.editingRules),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}
