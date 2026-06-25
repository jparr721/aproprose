import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+$/;

export interface VersionFiles {
  packageJson: string;
  cargoToml: string;
  tauriConf: string;
  cargoLock: string;
}

export function parseSemver(version: string): [number, number, number] {
  if (!SEMVER.test(version)) {
    throw new Error(`Invalid version "${version}": expected X.Y.Z (e.g. 0.2.0)`);
  }
  const [major, minor, patch] = version.split(".").map(Number);
  return [major, minor, patch];
}

export function isStrictlyGreater(next: string, current: string): boolean {
  const a = parseSemver(next);
  const b = parseSemver(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

export function readCurrentVersion(packageJsonPath: string): string {
  const match = readFileSync(packageJsonPath, "utf8").match(/"version":\s*"([^"]+)"/);
  if (!match) {
    throw new Error(`No "version" field found in ${packageJsonPath}`);
  }
  return match[1];
}

export function bumpVersion(next: string, files: VersionFiles): void {
  parseSemver(next);
  const current = readCurrentVersion(files.packageJson);
  if (!isStrictlyGreater(next, current)) {
    throw new Error(`Refusing to set version ${next}: it is not greater than the current ${current}`);
  }

  const pkg = readFileSync(files.packageJson, "utf8");
  writeFileSync(files.packageJson, pkg.replace(/"version":\s*"[^"]*"/, `"version": "${next}"`));

  const conf = readFileSync(files.tauriConf, "utf8");
  writeFileSync(files.tauriConf, conf.replace(/"version":\s*"[^"]*"/, `"version": "${next}"`));

  const toml = readFileSync(files.cargoToml, "utf8");
  writeFileSync(files.cargoToml, toml.replace(/^version = "[^"]*"$/m, `version = "${next}"`));

  const lock = readFileSync(files.cargoLock, "utf8");
  writeFileSync(files.cargoLock, lock.replace(/(name = "aproprose"\nversion = ")[^"]*(")/, `$1${next}$2`));
}

function main(): void {
  const next = process.argv[2];
  if (!next) {
    throw new Error("Usage: bun run scripts/set-version.ts <X.Y.Z>");
  }
  const root = resolve(import.meta.dirname, "..");
  bumpVersion(next, {
    packageJson: resolve(root, "package.json"),
    cargoToml: resolve(root, "src-tauri/Cargo.toml"),
    tauriConf: resolve(root, "src-tauri/tauri.conf.json"),
    cargoLock: resolve(root, "src-tauri/Cargo.lock"),
  });
  console.log(`Set version to ${next} (package.json, Cargo.toml, tauri.conf.json, Cargo.lock)`);
}

if (import.meta.main) {
  main();
}
