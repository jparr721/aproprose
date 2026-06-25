import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bumpVersion, isStrictlyGreater, parseSemver, type VersionFiles } from "./set-version";

const PKG = `{
  "name": "aproprose",
  "version": "0.1.0",
  "private": true
}
`;

const CARGO_TOML = `[package]
name = "aproprose"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = [] }
`;

const TAURI_CONF = `{
  "productName": "aproprose",
  "version": "0.1.0",
  "identifier": "com.jsp.aproprose"
}
`;

const CARGO_LOCK = `[[package]]
name = "other"
version = "9.9.9"

[[package]]
name = "aproprose"
version = "0.1.0"
dependencies = [
 "tauri",
]
`;

describe("set-version", () => {
  let dir: string;
  let files: VersionFiles;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "setver-"));
    files = {
      packageJson: join(dir, "package.json"),
      cargoToml: join(dir, "Cargo.toml"),
      tauriConf: join(dir, "tauri.conf.json"),
      cargoLock: join(dir, "Cargo.lock"),
    };
    writeFileSync(files.packageJson, PKG);
    writeFileSync(files.cargoToml, CARGO_TOML);
    writeFileSync(files.tauriConf, TAURI_CONF);
    writeFileSync(files.cargoLock, CARGO_LOCK);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rewrites the version in every file", () => {
    bumpVersion("0.2.0", files);
    expect(readFileSync(files.packageJson, "utf8")).toContain('"version": "0.2.0"');
    expect(readFileSync(files.tauriConf, "utf8")).toContain('"version": "0.2.0"');
    expect(readFileSync(files.cargoToml, "utf8")).toContain('version = "0.2.0"');
    expect(readFileSync(files.cargoLock, "utf8")).toContain('name = "aproprose"\nversion = "0.2.0"');
  });

  it("leaves unrelated content untouched", () => {
    bumpVersion("0.2.0", files);
    expect(readFileSync(files.cargoToml, "utf8")).toContain('tauri = { version = "2", features = [] }');
    expect(readFileSync(files.cargoLock, "utf8")).toContain('name = "other"\nversion = "9.9.9"');
  });

  it("accepts a semver-ordered bump that is not lexicographic (0.9.0 -> 0.10.0)", () => {
    writeFileSync(files.packageJson, PKG.replace("0.1.0", "0.9.0"));
    expect(() => bumpVersion("0.10.0", files)).not.toThrow();
    expect(readFileSync(files.packageJson, "utf8")).toContain('"version": "0.10.0"');
  });

  it("throws on a downgrade", () => {
    writeFileSync(files.packageJson, PKG.replace("0.1.0", "0.2.0"));
    expect(() => bumpVersion("0.1.0", files)).toThrow(/not greater/);
  });

  it("throws when the version is unchanged", () => {
    expect(() => bumpVersion("0.1.0", files)).toThrow(/not greater/);
  });

  it("throws on malformed input", () => {
    expect(() => bumpVersion("1.2", files)).toThrow(/expected X\.Y\.Z/);
    expect(() => bumpVersion("v1.2.3", files)).toThrow(/expected X\.Y\.Z/);
    expect(() => bumpVersion("abc", files)).toThrow(/expected X\.Y\.Z/);
  });

  it("parseSemver and isStrictlyGreater behave correctly", () => {
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
    expect(isStrictlyGreater("0.10.0", "0.9.0")).toBe(true);
    expect(isStrictlyGreater("0.1.0", "0.1.0")).toBe(false);
    expect(isStrictlyGreater("1.0.0", "0.9.9")).toBe(true);
  });
});
