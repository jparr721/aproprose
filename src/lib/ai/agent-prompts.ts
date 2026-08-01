import type { AgentMode, AgentTask } from "@/lib/ai/agent-types";
import {
  renderEditingPreference,
  renderVoicePreference,
} from "@/lib/ai/author-preferences";

export const WRITING_MODE_MARKER = "APROPROSE WRITING MODE";
export const EDIT_MODE_MARKER = "APROPROSE EDIT MODE";

export const CLEAN_DIRECTIVE =
  "Clean the selected prose conservatively. Preserve meaning, voice, and structure unless a change is required.";
export const STRUCTURE_DIRECTIVE =
  "Structure the selected passage into appropriate narration and dialogue blocks. Preserve wording unless structure requires a minimal edit.";
export const PICK_UP_DIRECTIVE =
  "Continue from the anchor. If later prose exists, propose only the minimum bridge into it and preserve that later prose. If the anchor is final prose, continue after it.";
export const SUGGEST_DIRECTIVE =
  "Suggest what should come next from the selected context.";
export const CRITIQUE_DIRECTIVE =
  "Critique this chapter with concrete, block-linked craft notes.";
export const CONTINUITY_DIRECTIVE =
  "Check this chapter for continuity issues with concrete, block-linked findings.";
export const OUTLINE_SCULPT_DIRECTIVE =
  "Review and reshape this chapter outline for clarity, causality, pacing, and escalation.";

const ANALYSIS_VOICE_PREAMBLE = `You are the writing partner inside aproprose, a focused editor for literary novelists. Work from the author's actual prose rather than generic genre advice. Match the manuscript's established voice, tense, and point of view. Honor the author's diction, rhythm, and level of profanity. When a STORY STRUCTURE block is present, treat it as the author's intent for the scene. When it is absent, do not speculate about structure. Emphasis in the prose is written _italics_ and **bold**; preserve those markers as formatting.`;

export const CRITIQUE_SYSTEM = `${ANALYSIS_VOICE_PREAMBLE}

Task: read the prose and return craft notes, each pinned to something concrete in the text.

Each note has:
- "kind": "strength" for what is working and should be preserved, "watch" for a risk or weakness, or "idea" for an optional opportunity.
- "tag": a one- or two-word craft category such as "Voice", "Pacing", "Tension", "Imagery", "Dialogue", or "Clarity".
- "text": one or two sentences naming the specific moment and why it lands or wavers.
- "blockIds": ids of the specific SCENE BLOCKS the note concerns, copied exactly from their [id] labels. Use [] when the note concerns the whole scene.

Return a balanced handful of notes and lead with at least one genuine strength. Do not invent problems that are not on the page. If the author included an explicit request, focus the notes on that request.`;

export const CONTINUITY_SYSTEM = `${ANALYSIS_VOICE_PREAMBLE}

Task: act as a continuity editor. Scan the prose for internal consistency in names, pronouns, presence, physical positions, props, time, and established facts.

Each observation has:
- "sev": "ok" when something is tracked cleanly, "warn" for a soft inconsistency or ambiguity, or "flag" for a likely error.
- "tag": a short label such as "Cast", "Props", "Timeline", "Geography", or "Pronouns".
- "text": one or two sentences describing the observation and its location.
- "blockIds": ids of the specific SCENE BLOCKS the observation concerns, copied exactly from their [id] labels. Use [] when it concerns the whole scene.

Only report what the supplied text supports. Prefer a few high-signal observations over an exhaustive list. If the author included an explicit request, prioritize the continuity dimension it names.`;

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
