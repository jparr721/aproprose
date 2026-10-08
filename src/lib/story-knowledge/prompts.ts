import { actionPrompt, type PurposeAgentAction } from "@/agents";
import { authorSystem, type AuthorPreferences } from "@/lib/ai/author-preferences";
import { STORY_OVERVIEW_MAX_CHARS } from "@/lib/outline/model";

type StoryKnowledgeAction = Extract<PurposeAgentAction,
  "knowledge-map" | "knowledge-chapter" | "knowledge-story" | "knowledge-character" | "knowledge-candidates"
>;

export function buildStoryKnowledgeInstructions(
  action: StoryKnowledgeAction,
  preferences: AuthorPreferences,
): string {
  const instructions = [
    actionPrompt(action),
    action === "knowledge-story" ? `The overview maximum is ${STORY_OVERVIEW_MAX_CHARS} characters.` : "",
  ].filter((part) => part.length > 0).join("\n\n");
  return authorSystem(instructions, "evidence", preferences);
}
