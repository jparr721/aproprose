import type { SaveOutcome } from "@/lib/project-operations";

export interface SaveBeforeExitDeps {
  readonly hasUnsavedChanges: () => boolean;
  readonly isCurrent: () => boolean;
  readonly saveChanges: () => Promise<SaveOutcome>;
}

export async function saveBeforeExit(deps: SaveBeforeExitDeps): Promise<boolean> {
  if (!deps.isCurrent()) return false;
  if (!deps.hasUnsavedChanges()) return true;
  const outcome = await deps.saveChanges();
  return (outcome.status === "saved" || outcome.status === "clean") &&
    deps.isCurrent() && !deps.hasUnsavedChanges();
}
