import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  highlights: string[];
}

export type DraftEntry = Pick<ChangelogEntry, "summary" | "highlights">;

export function buildPrompt(commitSubjects: string[], diff: string): string {
  const commits = commitSubjects.map((s) => `- ${s}`).join("\n");
  return [
    "You are writing a changelog entry for aproprose, a desktop writing app, for its users (writers, not developers).",
    "Summarize ONLY user-facing changes from the commits and diff below. Ignore refactors, chores, tests, CI, dependency bumps, and internal tooling.",
    "Respond with ONLY a JSON object, no prose and no code fences, in exactly this shape:",
    '{"summary": "one short sentence headline", "highlights": ["user-facing change", "another user-facing change"]}',
    "Use plain ASCII punctuation only: no em dashes, no smart quotes, no ellipses.",
    "If nothing is user-facing, give a brief summary and a one-item highlights array describing the maintenance nature.",
    "",
    "Commits:",
    commits,
    "",
    "Diff:",
    diff,
  ].join("\n");
}

function stripCodeFences(s: string): string {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fence ? fence[1] : s;
}

export function parseEntry(stdout: string): DraftEntry {
  const text = stripCodeFences(stdout).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`claude did not return valid JSON. Got:\n${stdout}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Expected a JSON object from claude, got: ${text}`);
  }
  const obj = parsed as Record<string, unknown>;
  const summary = obj.summary;
  const highlights = obj.highlights;
  if (typeof summary !== "string" || summary.trim() === "") {
    throw new Error(`Changelog "summary" must be a non-empty string. Got: ${text}`);
  }
  if (
    !Array.isArray(highlights) ||
    highlights.length === 0 ||
    !highlights.every((h) => typeof h === "string" && h.trim() !== "")
  ) {
    throw new Error(
      `Changelog "highlights" must be a non-empty array of non-empty strings. Got: ${text}`,
    );
  }
  return {
    summary: summary.trim(),
    highlights: (highlights as string[]).map((h) => h.trim()),
  };
}

export function prependEntry(
  existing: ChangelogEntry[],
  entry: ChangelogEntry,
): ChangelogEntry[] {
  if (existing.some((e) => e.version === entry.version)) {
    throw new Error(`changelog.json already has an entry for ${entry.version}`);
  }
  return [entry, ...existing];
}

function gitLastTag(): string | null {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function gitRange(lastTag: string | null): string {
  return lastTag ? `${lastTag}..HEAD` : "HEAD";
}

function collectCommits(range: string): string[] {
  return execFileSync("git", ["log", "--pretty=%s", range], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function collectDiff(range: string): string {
  return execFileSync("git", ["diff", range], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function runClaude(prompt: string): string {
  try {
    return execFileSync("claude", ["-p"], {
      input: prompt,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    throw new Error(
      `Failed to run "claude -p" (is the Claude CLI installed and on PATH?): ${String(e)}`,
    );
  }
}

function reviewInEditor(draft: DraftEntry): DraftEntry {
  const editor = process.env.EDITOR;
  if (!editor) {
    throw new Error("$EDITOR is not set; cannot review the changelog draft.");
  }
  const dir = mkdtempSync(join(tmpdir(), "changelog-"));
  const file = join(dir, "entry.json");
  try {
    writeFileSync(file, JSON.stringify(draft, null, 2) + "\n");
    execFileSync(editor, [file], { stdio: "inherit" });
    const edited = readFileSync(file, "utf8");
    try {
      return parseEntry(edited);
    } catch (e) {
      throw new Error(`The edited changelog entry is not valid: ${String(e)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): void {
  const version = process.argv[2];
  const date = process.argv[3];
  if (!version || !date) {
    throw new Error("Usage: bun run scripts/generate-changelog.ts <X.Y.Z> <YYYY-MM-DD>");
  }
  const root = resolve(import.meta.dirname, "..");
  const changelogPath = resolve(root, "changelog.json");
  const existing = JSON.parse(readFileSync(changelogPath, "utf8")) as ChangelogEntry[];

  const range = gitRange(gitLastTag());
  const prompt = buildPrompt(collectCommits(range), collectDiff(range));
  const draft = parseEntry(runClaude(prompt));
  const reviewed = reviewInEditor(draft);

  const entry: ChangelogEntry = {
    version,
    date,
    summary: reviewed.summary,
    highlights: reviewed.highlights,
  };
  const next = prependEntry(existing, entry);
  writeFileSync(changelogPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`Wrote changelog entry for ${version} (${entry.highlights.length} highlights).`);
}

if (import.meta.main) {
  main();
}
