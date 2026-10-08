import type { ProjectMeta } from "@/lib/types";

export interface ProjectSyncSnapshot {
  lifecycleGeneration: number;
  editRevision: number;
  meta: ProjectMeta;
}

export type SaveOutcome =
  | { status: "saved" | "clean" }
  | { status: "stale" }
  | { status: "blocked" | "failed"; message: string };

const projectOperationTails = new Map<string, Promise<void>>();
const remoteRevisions = new Map<string, number>();

export function projectRemoteRevision(root: string): number {
  return remoteRevisions.get(root) ?? 0;
}

export function noteProjectRemoteChanges(root: string): void {
  remoteRevisions.set(root, projectRemoteRevision(root) + 1);
}

export function queueProjectOperation<Result>(
  root: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const previous = projectOperationTails.get(root);
  let result: Promise<Result>;
  try {
    result = previous === undefined ? operation() : previous.then(operation);
  } catch (error) {
    result = Promise.reject(error);
  }
  const tail = result.then(() => undefined, () => undefined).finally(() => {
    if (projectOperationTails.get(root) === tail) projectOperationTails.delete(root);
  });
  projectOperationTails.set(root, tail);
  return result;
}
