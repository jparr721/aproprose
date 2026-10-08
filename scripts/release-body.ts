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
import { z } from "zod";

const changelogSchema = z.array(z.object({
  version: z.string(),
  date: z.string(),
  summary: z.string(),
  highlights: z.array(z.string()),
}));

export type ChangelogEntry = z.infer<typeof changelogSchema>[number];

export function parseChangelog(changelog: unknown): ChangelogEntry[] {
  const result = changelogSchema.safeParse(changelog);
  if (!result.success) {
    throw new Error(`Invalid changelog.json: ${result.error.message}`);
  }
  return result.data;
}

export function findEntry(changelog: unknown, version: string): ChangelogEntry {
  const entries = parseChangelog(changelog).filter((entry) => entry.version === version);
  if (entries.length > 1) {
    throw new Error(`changelog.json has duplicate entries for ${version}`);
  }
  const entry = entries[0];
  if (!entry) {
    throw new Error(`changelog.json has no entry for ${version}`);
  }
  const date = new Date(`${entry.date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== entry.date
  ) {
    throw new Error(`changelog.json entry for ${version} has an invalid date; expected YYYY-MM-DD`);
  }
  if (entry.summary.trim() === "") {
    throw new Error(`changelog.json entry for ${version} has an invalid summary`);
  }
  if (
    entry.highlights.length === 0 ||
    !entry.highlights.every((h) => h.trim() !== "")
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
  const changelog: unknown = JSON.parse(readFileSync(changelogPath, "utf8"));
  process.stdout.write(buildReleaseBody(findEntry(changelog, version)));
}

if (import.meta.main) {
  main();
}
