// path-hash.ts — FNV-1a over an absolute path. Used to key per-project records
// in the app config dir without leaking the path. (Extracted from project-store
// so the sync store can share it.)

export function pathHash(root: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < root.length; i++) {
    h ^= root.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
