// id.ts — tiny id helpers.

let counter = 0;

/** A process-unique id for client-created blocks. Stable within a session. */
export function uid(prefix = "b"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
