import type { AgentMode, AgentSessionId, AgentTask } from "@/lib/ai/agent-types";
import { agentSessionProfile } from "@/lib/ai/agent-types";
import { AuthorProfile } from "@/author";
import { actionPrompt, createPurposeAgent, type PurposeAgentAction, type PurposeAgentPolicy } from "@/agents";

export const WRITING_MODE_MARKER = "APROPROSE WRITING MODE";
export const EDIT_MODE_MARKER = "APROPROSE EDIT MODE";
export const OUTLINE_PLANNING_MARKER = "APROPROSE OUTLINE PLANNING";
export const CHARACTER_DESCRIBE_MARKER = "APROPROSE CHARACTER DESCRIBE";

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

const ANALYSIS_VOICE_PREAMBLE = `You are the writing partner inside aproprose, a focused editor for literary novelists. You work on a single manuscript at a time and always reason from the author's actual prose, never from genre cliche. Match the manuscript's established voice, tense, and point of view exactly - if the prose is first-person present, you stay first-person present. Honour the author's diction, rhythm, and level of profanity; do not sanitise or "improve" their style. Be concrete and specific to the text in front of you; never give generic writing advice that could apply to any book. When a "STORY STRUCTURE" block is present, treat it as the author's intent for this scene: aim continuations at the beat it serves, and flag drift from the beat or the chapter's stated Goal/Conflict/Turn. When it is absent, do not speculate about structure. Emphasis in the prose you read is written _italics_ and **bold**; treat these as formatting to preserve, never as errors to fix.`;

export const CRITIQUE_SYSTEM = `${ANALYSIS_VOICE_PREAMBLE}

${actionPrompt("craft-critic")}

Task: read the prose and return craft notes, each pinned to something concrete in the text.

Each note has:
- "kind": "strength" for what is working and should be preserved, "watch" for a risk or weakness to keep an eye on, "idea" for an optional opportunity to push further.
- "tag": a one- or two-word craft category, e.g. "Voice", "Pacing", "Tension", "Imagery", "Dialogue", "Clarity".
- "text": one or two sentences naming the specific moment and why it lands or wavers. Quote or paraphrase the actual line you mean.
- "blockIds": the ids of the specific SCENE BLOCKS the note is about, copied exactly from their [id] labels. Use [] when the note concerns the whole scene.

Return high-signal findings in order of editorial impact. Include genuine strengths when their preservation matters; do not manufacture praise. Do not invent problems that aren't on the page.

If the author included an explicit request ("AUTHOR'S REQUEST"), focus your notes on what they asked about. Otherwise, cover the most important craft notes you see.`;

export const CONTINUITY_SYSTEM = `${ANALYSIS_VOICE_PREAMBLE}

${actionPrompt("continuity-editor")}

Task: act as a continuity editor. Scan the prose for internal consistency - names, pronouns, who is present, physical positions, props, time of day, established facts - and report what you find.

Each observation has:
- "sev": "ok" when something is tracked cleanly and worth confirming, "warn" for a soft inconsistency or ambiguity the author may have intended, "flag" for a likely error that breaks continuity.
- "tag": a short label for the thing being tracked, e.g. "Cast", "Props", "Timeline", "Geography", "Pronouns".
- "text": one or two sentences describing the observation, naming the specific detail and where it appears.
- "blockIds": the ids of the specific SCENE BLOCKS the observation is about, copied exactly from their [id] labels. Use [] when it concerns the whole scene.

Only report what the supplied text actually supports - if you cannot see earlier chapters, do not assume a contradiction with them. Prefer a few high-signal observations over an exhaustive list.

If the author included an explicit request ("AUTHOR'S REQUEST"), prioritise the continuity dimension they named. Otherwise, sweep broadly.`;

const BASE_AGENT_INSTRUCTIONS = `You are the agent inside aproprose. Work only on the open project represented by the supplied conversation, immutable attachments, and tools.

Use read_outline with a null chapter id to discover the novel's chapters, characters, plot points, and structure. Fetch relevant prose with read_chapter and worldbuilding with read_lore before making source-specific claims. Do not ask the author to attach source that these tools can retrieve. Show useful conclusions in concise prose. Never expose chain-of-thought or hidden reasoning.

When the author requests manuscript or outline changes, stage one complete proposal for review. Never claim a project write occurred. The author alone applies reviewed changes through the proposal tray.

If the author's desired outcome, constraints, or meaning are unclear, ask concise clarification questions before staging changes. Make every proposal change independently reviewable. Do not treat discussed or rejected ideas as approved.

After material changes, check whether the story overview must change. Propose a concise high-level replacement only when the premise, central conflict, stakes, major arcs or relationships, world rules, broad direction, or ending intent changed. Do not update it for prose polish or minor beats. Keep it under 2,000 characters and do not turn it into a chapter recap. Include the replacement in the manuscript or outline proposal when related, or use an overview-only proposal when no other source change is needed.

Read and preserve existing later prose. Use exact source ids returned by tools. A pending proposal is a complete workspace: read it before a follow-up, then stage one complete replacement.`;

function taskInstructions(task: AgentTask): string {
  if (task.kind === "bridge") {
    const rightBoundary =
      task.successorBlockId === null
        ? "There is no later prose boundary; append after the anchor."
        : `Preserve successor prose block ${task.successorBlockId} and every later block.`;
    const leftBoundary = task.anchorBlockId === null
      ? "The chapter has no prose. Insert its opening with afterId null."
      : `Insert only after prose block ${task.anchorBlockId}.`;
    return `FROZEN TASK: continuation. ${leftBoundary} ${rightBoundary} You must use stage_manuscript_proposal to stage a nonempty insertion. A conversational suggestion alone does not complete this task. Do not stage an overview-only proposal.`;
  }
  if (task.kind === "selected-block-edit") {
    return `FROZEN TASK: ${task.operation} only blocks ${task.blockIds.join(", ")} in chapter ${task.chapterId}.`;
  }
  if (task.kind === "chapter-analysis") {
    return `FROZEN TASK: read-only ${task.analysis} for chapter ${task.chapterId}.`;
  }
  if (task.kind === "outline-sculpt") {
    return `FROZEN TASK: inspect and collaboratively plan chapter ${task.chapterId}. Diagnose existing material without waiting for the author to restate it. Stage outline changes only for that chapter. Revise independently reviewable cards from actual answers and current reviewed work; do not treat possibilities as author decisions.`;
  }
  if (task.kind === "next-beat") {
    return `FROZEN TASK: read-only next-beat suggestions for blocks ${task.blockIds.join(", ")} in chapter ${task.chapterId}.`;
  }
  if (task.kind === "proposal-follow-up") {
    return `FROZEN TASK: replace pending proposal ${task.proposalId} completely.`;
  }
  if (task.kind === "character-describe") {
    return `FROZEN TASK: describe character ${task.characterId} and update only that character's profile.`;
  }
  return task.targetChapterId === null
    ? "FROZEN TASK: conversation with no write target."
    : `FROZEN TASK: conversation may stage changes only for chapter ${task.targetChapterId}.`;
}

export interface AgentPolicyInput {
  mode: AgentMode;
  task: AgentTask;
  styleGuide: string;
  editingRules: string;
  sessionId: AgentSessionId;
}

export function resolvePurposeAgentAction(args: Pick<AgentPolicyInput, "mode" | "task" | "sessionId">): PurposeAgentAction {
  const profile = agentSessionProfile(args.sessionId, args.mode);
  if (profile.kind === "character" || args.task.kind === "character-describe") return "character-developer";
  if (profile.kind === "outline" || args.task.kind === "outline-sculpt") return "chapter-planner";
  switch (args.task.kind) {
    case "bridge": return "bridge-writer";
    case "next-beat": return "next-beat";
    case "selected-block-edit":
      return args.task.operation === "clean" ? "copyeditor" : args.task.operation === "structure" ? "block-structurer" : "literary-editor";
    case "chapter-analysis": return args.task.analysis === "critique" ? "craft-critic" : "continuity-editor";
    case "conversation":
    case "proposal-follow-up": return args.mode === "writing" ? "writer" : "literary-editor";
  }
}

export function compileAgentPolicy(args: AgentPolicyInput): PurposeAgentPolicy {
  const action = resolvePurposeAgentAction(args);
  const author = new AuthorProfile({ read: () => ({ styleGuide: args.styleGuide, editingRules: args.editingRules }) }).resolve();
  const marker = action === "chapter-planner" ? OUTLINE_PLANNING_MARKER
    : action === "character-developer" ? CHARACTER_DESCRIBE_MARKER
      : args.mode === "writing" ? WRITING_MODE_MARKER : EDIT_MODE_MARKER;
  return createPurposeAgent(action, author).compile({
    applicationInstructions: action === "character-developer" ? "Work only on the open project. Never expose chain-of-thought or hidden reasoning." : BASE_AGENT_INSTRUCTIONS,
    taskInstructions: taskInstructions(args.task),
    marker,
  });
}

export function buildAgentInstructions(args: AgentPolicyInput): string {
  return compileAgentPolicy(args).instructions;
}
