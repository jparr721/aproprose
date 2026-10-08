import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { isStrictlyGreater } from "./set-version";

export interface ReleaseFiles {
  basePackageJson: string;
  packageJson: string;
  cargoToml: string;
  tauriConf: string;
  cargoLock: string;
  changelog: string;
}

const versionSchema = z.object({ version: z.string() });
const changelogSchema = z.array(z.object({
  version: z.string(),
  date: z.iso.date(),
  summary: z.string().trim().min(1),
  highlights: z.array(z.string().trim().min(1)).min(1),
})).min(1);

export function checkRelease(files: ReleaseFiles): void {
  const current = versionSchema.parse(JSON.parse(files.basePackageJson)).version;
  const next = versionSchema.parse(JSON.parse(files.packageJson)).version;
  if (!isStrictlyGreater(next, current)) {
    throw new Error(`Bump the version in package.json: ${next} must be greater than base version ${current}.`);
  }

  const versions = [
    ["src-tauri/Cargo.toml", files.cargoToml.match(/^version = "([^"]+)"$/m)?.[1]],
    ["src-tauri/tauri.conf.json", versionSchema.parse(JSON.parse(files.tauriConf)).version],
    ["src-tauri/Cargo.lock", files.cargoLock.match(/name = "aproprose"\nversion = "([^"]+)"/)?.[1]],
  ] as const;
  for (const [path, version] of versions) {
    if (version !== next) {
      throw new Error(`${path} must match package.json version ${next}. Run scripts/set-version.ts to synchronize the version files.`);
    }
  }

  const entries = changelogSchema.parse(JSON.parse(files.changelog));
  if (entries[0].version !== next) {
    throw new Error(`The first changelog entry must describe version ${next}. Add its date, summary, and highlights to changelog.json.`);
  }
}

function main(): void {
  const baseRef = process.argv[2];
  if (!baseRef) {
    throw new Error("Usage: bun run scripts/check-release.ts <base-ref>");
  }
  const root = resolve(import.meta.dirname, "..");
  checkRelease({
    basePackageJson: execFileSync("git", ["show", `${baseRef}:package.json`], { encoding: "utf8" }),
    packageJson: readFileSync(resolve(root, "package.json"), "utf8"),
    cargoToml: readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8"),
    tauriConf: readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
    cargoLock: readFileSync(resolve(root, "src-tauri/Cargo.lock"), "utf8"),
    changelog: readFileSync(resolve(root, "changelog.json"), "utf8"),
  });
}

if (import.meta.main) {
  main();
}
