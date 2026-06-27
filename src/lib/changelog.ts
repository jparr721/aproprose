// changelog.ts - typed access to the bundled changelog and the encode/decode pair for
// an updater notes body (latest.json `notes`). buildReleaseBody produces the body
// (summary line, blank line, then one `- highlight` per line); parseUpdateNotes is its
// exact inverse. scripts/release-body.ts builds the release body via buildReleaseBody, so
// the release workflow and the in-app parser share a single definition of the format.

import changelogData from "../../changelog.json";

export interface ChangelogEntry {
  readonly version: string;
  readonly date: string;
  readonly summary: string;
  readonly highlights: readonly string[];
}

export interface IncomingNotes {
  readonly summary: string;
  readonly highlights: readonly string[];
}

export const CHANGELOG: ChangelogEntry[] = changelogData as ChangelogEntry[];

export function buildReleaseBody(entry: Pick<ChangelogEntry, "summary" | "highlights">): string {
  return [entry.summary, "", ...entry.highlights.map((h) => `- ${h}`)].join("\n");
}

export function parseUpdateNotes(body: string): IncomingNotes {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const highlights: string[] = [];
  const summaryLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("- ")) {
      highlights.push(line.slice(2).trim());
    } else {
      summaryLines.push(line);
    }
  }
  return { summary: summaryLines.join(" "), highlights };
}
