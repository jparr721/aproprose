import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { findEntry, parseChangelog } from "./release-body";
import { isStrictlyGreater } from "./set-version";

export type VersionPath =
  | "package.json"
  | "src-tauri/tauri.conf.json"
  | "src-tauri/Cargo.toml"
  | "src-tauri/Cargo.lock";

type ReleasePath = VersionPath | "changelog.json";

export const VERSION_FILES: readonly VersionPath[] = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

export interface ReleaseFiles {
  versions: Readonly<Record<VersionPath, string>>;
  changelog: string;
}

const manifestSchema = z.object({ version: z.string() });
const STABLE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function validateVersion(version: string): void {
  if (
    !STABLE_VERSION.test(version) ||
    !version.split(".").every((part) => Number.isSafeInteger(Number(part)))
  ) {
    throw new Error(`Invalid stable version "${version}"; expected major.minor.patch without leading zeros`);
  }
}

function parseJson(path: string, content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${String(error)}`);
  }
}

export function readVersion(path: VersionPath, content: string): string {
  let version: string;
  if (path.endsWith(".json")) {
    const parsed = parseJson(path, content);
    const result = manifestSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`${path} must contain a string version: ${result.error.message}`);
    }
    version = result.data.version;
  } else {
    const sections = content.split(path.endsWith("Cargo.lock") ? /^\s*\[\[package\]\]\s*$/m : /^\s*\[package\]\s*$/m).slice(1);
    const packages = sections
      .map((section) => section.split(/^\s*\[/m)[0])
      .filter((section) => /^\s*name\s*=\s*"aproprose"\s*(?:#.*)?$/m.test(section));
    if (packages.length !== 1) {
      throw new Error(`${path} must contain exactly one aproprose package`);
    }
    const versions = [...packages[0].matchAll(/^\s*version\s*=\s*"([^"]+)"\s*(?:#.*)?$/gm)];
    if (versions.length !== 1) {
      throw new Error(`${path} must contain exactly one aproprose package version`);
    }
    version = versions[0][1];
  }
  validateVersion(version);
  return version;
}

export function validateRelease(base: ReleaseFiles, proposed: ReleaseFiles): string {
  for (const [label, snapshot] of [["Target branch", base], ["Proposed change", proposed]] satisfies [string, ReleaseFiles][]) {
    const versions = VERSION_FILES.map((path) => {
      const version = snapshot.versions[path];
      if (typeof version !== "string") {
        throw new Error(`${label} is missing a version in ${path}`);
      }
      validateVersion(version);
      return version;
    });
    if (new Set(versions).size !== 1) {
      throw new Error(`${label} version files disagree: ${JSON.stringify(snapshot.versions)}`);
    }
  }
  const current = base.versions["package.json"];
  const version = proposed.versions["package.json"];
  if (!isStrictlyGreater(version, current)) {
    throw new Error(`Version must increase from ${current}; proposed ${version}. Bump all four version files.`);
  }
  if (base.changelog === proposed.changelog) {
    throw new Error(`changelog.json must change with a new entry for ${version}`);
  }
  const changelog = parseChangelog(parseJson("Proposed changelog.json", proposed.changelog));
  const entry = findEntry(changelog, version);
  if (changelog[0].version !== version) {
    throw new Error(`The first changelog.json entry must be the new version ${version}`);
  }
  if (parseChangelog(parseJson("Target changelog.json", base.changelog)).some((previous) => previous.version === version)) {
    throw new Error(`changelog.json must add a new entry for ${version}; that version already exists on the target branch`);
  }
  for (const previous of changelog.slice(1)) {
    validateVersion(previous.version);
    if (!isStrictlyGreater(entry.version, previous.version)) {
      throw new Error(`changelog.json version ${version} must be newer than ${previous.version}`);
    }
  }
  return version;
}

function readReleaseFiles(read: (path: ReleasePath) => string): ReleaseFiles {
  return {
    versions: {
      "package.json": readVersion("package.json", read("package.json")),
      "src-tauri/tauri.conf.json": readVersion("src-tauri/tauri.conf.json", read("src-tauri/tauri.conf.json")),
      "src-tauri/Cargo.toml": readVersion("src-tauri/Cargo.toml", read("src-tauri/Cargo.toml")),
      "src-tauri/Cargo.lock": readVersion("src-tauri/Cargo.lock", read("src-tauri/Cargo.lock")),
    },
    changelog: read("changelog.json"),
  };
}

export function checkRelease({ root, baseRef }: { root: string; baseRef: string }): string {
  const baseSha = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const base = readReleaseFiles((path) => execFileSync("git", ["show", `${baseSha}:${path}`], {
    cwd: root,
    encoding: "utf8",
  }));
  const proposed = readReleaseFiles((path) => readFileSync(resolve(root, path), "utf8"));
  return validateRelease(base, proposed);
}

function main(): void {
  const baseRef = process.argv[2];
  if (!baseRef) {
    throw new Error("Usage: bun run scripts/check-release.ts <base-ref>");
  }
  const version = checkRelease({ root: resolve(import.meta.dirname, ".."), baseRef });
  process.stdout.write(`${version}\n`);
}

if (import.meta.main) {
  main();
}
