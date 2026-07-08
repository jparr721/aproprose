import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ChangelogEntry is intentionally duplicated from src/lib/changelog.ts: the scripts and
// app TS projects are separate module graphs (see tsconfig.node.json), and this producer
// type is mutable while the app's consumer type is readonly. The shared on-disk format is
// the JSON shape, pinned by tests on both sides.
export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  highlights: string[];
}

export type DraftEntry = Pick<ChangelogEntry, "summary" | "highlights">;

// The empty git tree object. Diffing against it yields the full project history for the
// first release, where there is no prior tag to diff from (`git diff HEAD` on a clean
// tree compares the worktree to HEAD and is empty, so it cannot be used here).
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SEMVER = /^\d+\.\d+\.\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const OPENCODE_MODEL = "openai/gpt-5.5";
const OPENCODE_MESSAGE =
  "Use the attached changelog prompt file as your full instructions. Return only the JSON object.";

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

export function stripCodeFences(s: string): string {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fence ? fence[1] : s;
}

export function parseEntry(stdout: string): DraftEntry {
  const text = stripCodeFences(stdout).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`OpenCode did not return valid JSON. Got:\n${stdout}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Expected a JSON object from OpenCode, got: ${text}`);
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

export function commitRange(lastTag: string | null): string {
  return lastTag ? `${lastTag}..HEAD` : "HEAD";
}

export function diffRange(lastTag: string | null): string {
  return `${lastTag ?? EMPTY_TREE}..HEAD`;
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

export function openCodeArgs(promptFilePath: string): string[] {
  return [
    "run",
    "--model",
    OPENCODE_MODEL,
    "--format",
    "default",
    OPENCODE_MESSAGE,
    "-f",
    promptFilePath,
  ];
}

function runOpenCode(prompt: string): string {
  const dir = mkdtempSync(join(tmpdir(), "changelog-prompt-"));
  const file = join(dir, "prompt.txt");
  try {
    writeFileSync(file, prompt);
    return execFileSync("opencode", openCodeArgs(file), {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    throw new Error(
      `Failed to run "opencode run --model ${OPENCODE_MODEL}" (is OpenCode installed and authenticated?): ${String(e)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
  const args = process.argv.slice(2);
  const autoAccept = args.includes("--yes");
  const positional = args.filter((a) => !a.startsWith("-"));
  const version = positional[0];
  const date = positional[1];
  if (!version || !date) {
    throw new Error(
      "Usage: bun run scripts/generate-changelog.ts <X.Y.Z> <YYYY-MM-DD> [--yes]",
    );
  }
  if (!SEMVER.test(version)) {
    throw new Error(`Invalid version "${version}": expected X.Y.Z (e.g. 0.4.0)`);
  }
  if (!ISO_DATE.test(date)) {
    throw new Error(`Invalid date "${date}": expected YYYY-MM-DD`);
  }
  const root = resolve(import.meta.dirname, "..");
  const changelogPath = resolve(root, "changelog.json");
  const existing = JSON.parse(readFileSync(changelogPath, "utf8")) as ChangelogEntry[];

  const lastTag = gitLastTag();
  const prompt = buildPrompt(
    collectCommits(commitRange(lastTag)),
    collectDiff(diffRange(lastTag)),
  );
  const draft = parseEntry(runOpenCode(prompt));
  // --yes accepts the AI draft verbatim (non-interactive release); otherwise the
  // author reviews/edits it in $EDITOR before it is written.
  const reviewed = autoAccept ? draft : reviewInEditor(draft);

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
