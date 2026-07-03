// cache-key.ts - the one builder for right-panel AI cache keys.
//
// Entries in ai-cache-store are keyed "<op>:<chapter>:<scope>:<sel>" so a
// genuine change of scene/scope/selection reads as idle while a remount reuses
// the cached result. Each tab supplies its own selectionKey semantics
// (suggest/critique/continuity cursor scope -> selected id; edit block scope ->
// sorted selection set; chapter scope -> ""); the shape lives only here.

export type AiCacheOp = "suggest" | "edit" | "critique" | "continuity";

/** The single builder for right-panel cache keys: "<op>:<chapter>:<scope>:<sel>". */
export function aiCacheKey(
  op: AiCacheOp,
  chapterId: string | null,
  scope: string,
  selectionKey: string,
): string {
  return `${op}:${chapterId ?? ""}:${scope}:${selectionKey}`;
}
