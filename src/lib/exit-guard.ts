export interface SaveBeforeExitDeps {
  readonly hasUnsavedChanges: () => boolean;
  readonly saveChanges: () => Promise<void>;
}

export async function saveBeforeExit(deps: SaveBeforeExitDeps): Promise<boolean> {
  if (!deps.hasUnsavedChanges()) return true;
  await deps.saveChanges();
  return !deps.hasUnsavedChanges();
}
