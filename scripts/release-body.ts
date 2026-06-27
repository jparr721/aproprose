// release-body.ts - CLI that prints the GitHub release body for a tagged version to
// stdout for .github/workflows/release.yml. The pure helpers (findEntry, buildReleaseBody)
// are exported and unit tested in release-body.test.ts; main() is the thin IO shell. This
// mirrors generate-changelog.ts: exported helpers + a main()/import.meta.main guard in one
// file. A missing or hand-edited malformed changelog.json entry makes findEntry throw, so
// the release fails with an actionable message instead of a cryptic crash in the workflow.
//
// The body format (summary line, blank line, then one `- highlight` per line) mirrors
// buildReleaseBody in src/lib/changelog.ts and is the exact inverse of the app's
// parseUpdateNotes; both formats are pinned by tests, so producer and consumer cannot drift.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  highlights: string[];
}

export function findEntry(changelog: ChangelogEntry[], version: string): ChangelogEntry {
  const entry = changelog.find((e) => e.version === version);
  if (!entry) {
    throw new Error(`changelog.json has no entry for ${version}`);
  }
  if (typeof entry.summary !== "string" || entry.summary.trim() === "") {
    throw new Error(`changelog.json entry for ${version} has an invalid summary`);
  }
  if (
    !Array.isArray(entry.highlights) ||
    entry.highlights.length === 0 ||
    !entry.highlights.every((h) => typeof h === "string" && h.trim() !== "")
  ) {
    throw new Error(`changelog.json entry for ${version} has invalid highlights`);
  }
  return entry;
}

export function buildReleaseBody(entry: Pick<ChangelogEntry, "summary" | "highlights">): string {
  return [entry.summary, "", ...entry.highlights.map((h) => `- ${h}`)].join("\n");
}

function main(): void {
  const version = process.argv[2];
  if (!version) {
    throw new Error("Usage: bun run scripts/release-body.ts <X.Y.Z>");
  }
  const changelogPath = resolve(import.meta.dirname, "..", "changelog.json");
  const changelog = JSON.parse(readFileSync(changelogPath, "utf8")) as ChangelogEntry[];
  process.stdout.write(buildReleaseBody(findEntry(changelog, version)));
}

if (import.meta.main) {
  main();
}
