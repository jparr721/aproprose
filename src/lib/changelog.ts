// changelog.ts - typed access to the bundled changelog and the parser that turns
// an updater notes body (latest.json `notes`) back into structured highlights.
// The release-body format is: summary line, blank line, then one `- highlight`
// per line (produced by .github/workflows/release.yml). This is its inverse.

import changelogData from "../../changelog.json";

export interface ChangelogEntry {
  readonly version: string;
  readonly date: string;
  readonly summary: string;
  readonly highlights: string[];
}

export interface IncomingNotes {
  readonly summary: string;
  readonly highlights: string[];
}

export const CHANGELOG: ChangelogEntry[] = changelogData as ChangelogEntry[];

export function parseUpdateNotes(body: string): IncomingNotes {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const highlights: string[] = [];
  let summary = "";
  for (const line of lines) {
    if (line.startsWith("- ")) {
      highlights.push(line.slice(2).trim());
    } else if (summary === "") {
      summary = line;
    }
  }
  return { summary, highlights };
}
