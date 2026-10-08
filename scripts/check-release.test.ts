import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkRelease, readVersion, validateRelease, VERSION_FILES, type ReleaseFiles } from "./check-release";

function entry(version: string): { version: string; date: string; summary: string; highlights: string[] } {
  return { version, date: "2026-10-07", summary: "Clearer authoring preferences.", highlights: ["Refine preferences with AI"] };
}

function snapshot(version: string): ReleaseFiles {
  return {
    versions: {
      "package.json": version,
      "src-tauri/tauri.conf.json": version,
      "src-tauri/Cargo.toml": version,
      "src-tauri/Cargo.lock": version,
    },
    changelog: JSON.stringify([entry(version)]),
  };
}

describe("readVersion", () => {
  it.each(["package.json", "src-tauri/tauri.conf.json"] satisfies (typeof VERSION_FILES[number])[])(
    "reads the top-level JSON version in %s",
    (path) => {
      expect(readVersion(path, '{"nested":{"version":"9.9.9"},"version":"0.18.0"}')).toBe("0.18.0");
      expect(() => readVersion(path, '{"version":18}')).toThrow(/string version/);
    },
  );

  it("reads only the aproprose package version from Cargo.toml", () => {
    expect(readVersion("src-tauri/Cargo.toml", '[package]\nname = "aproprose"\nversion = "0.18.0"\n[dependencies]\nversion = "99.0.0"\n')).toBe("0.18.0");
  });

  it("identifies the manifest when its JSON is malformed", () => {
    expect(() => readVersion("package.json", "{" )).toThrow(/Cannot parse package.json/);
  });

  it("reads only the aproprose package version from Cargo.lock", () => {
    const lock = '[[package]]\nname = "other"\nversion = "9.9.9"\n\n[[package]]\nname = "aproprose"\nversion = "0.18.0"\n';
    expect(readVersion("src-tauri/Cargo.lock", lock)).toBe("0.18.0");
  });

  it.each([
    '[package]\nname = "other"\nversion = "0.18.0"\n',
    '[package]\nname = "aproprose"\n',
    '[package]\nname = "aproprose"\nversion = "0.18.0"\nversion = "0.19.0"\n',
  ])("rejects missing or ambiguous package versions", (content) => {
    expect(() => readVersion("src-tauri/Cargo.toml", content)).toThrow(/exactly one/);
  });

  it("rejects duplicate aproprose lock entries", () => {
    const pkg = '[[package]]\nname = "aproprose"\nversion = "0.18.0"\n';
    expect(() => readVersion("src-tauri/Cargo.lock", pkg + pkg)).toThrow(/exactly one/);
  });
});

describe("validateRelease", () => {
  it.each(["0.17.2", "0.18.0", "1.0.0"])("accepts the coherent version increase to %s", (version) => {
    expect(validateRelease(snapshot("0.17.1"), snapshot(version))).toBe(version);
  });

  it("compares numeric components instead of sorting text", () => {
    expect(validateRelease(snapshot("0.9.0"), snapshot("0.10.0"))).toBe("0.10.0");
  });

  it.each(["0.17.1", "0.17.0", "0.16.99"])("rejects a missing bump or downgrade to %s", (version) => {
    expect(() => validateRelease(snapshot("0.17.1"), snapshot(version))).toThrow(/Version must increase/);
  });

  it("rejects a branch whose proposed version has already landed on its target", () => {
    expect(() => validateRelease(snapshot("0.18.0"), snapshot("0.18.0"))).toThrow(/Version must increase/);
  });

  it.each(VERSION_FILES)("rejects a proposed mismatch in %s", (path) => {
    const proposed = snapshot("0.18.0");
    expect(() => validateRelease(snapshot("0.17.1"), {
      ...proposed,
      versions: { ...proposed.versions, [path]: "0.19.0" },
    })).toThrow(/Proposed change version files disagree/);
  });

  it("rejects inconsistent target versions", () => {
    const base = snapshot("0.17.1");
    expect(() => validateRelease({ ...base, versions: { ...base.versions, "src-tauri/Cargo.lock": "0.17.0" } }, snapshot("0.18.0"))).toThrow(/Target branch version files disagree/);
  });

  it.each(["v0.18.0", "0.18", "0.18.0-beta.1", "00.18.0", "0.018.0", "0.18.00", "9007199254740992.0.0"])(
    "rejects the noncanonical stable version %j",
    (version) => {
      expect(() => validateRelease(snapshot("0.17.1"), snapshot(version))).toThrow(/Invalid stable version/);
    },
  );

  it("requires changelog.json to change", () => {
    const base = snapshot("0.17.1");
    expect(() => validateRelease(base, { ...snapshot("0.18.0"), changelog: base.changelog })).toThrow(/must change/);
  });

  it("identifies malformed proposed changelog JSON", () => {
    expect(() => validateRelease(snapshot("0.17.1"), { ...snapshot("0.18.0"), changelog: "{" })).toThrow(/Cannot parse Proposed changelog.json/);
  });

  it("rejects an unrelated changelog edit without the new version", () => {
    expect(() => validateRelease(snapshot("0.17.1"), {
      ...snapshot("0.18.0"), changelog: JSON.stringify([{ ...entry("0.17.1"), summary: "Edited an old entry" }]),
    })).toThrow(/no entry for 0.18.0/);
  });

  it("requires the new entry to be first", () => {
    expect(() => validateRelease(snapshot("0.17.1"), {
      ...snapshot("0.18.0"), changelog: JSON.stringify([entry("0.17.1"), entry("0.18.0")]),
    })).toThrow(/first changelog.json entry/);
  });

  it("rejects duplicate current-version entries", () => {
    expect(() => validateRelease(snapshot("0.17.1"), {
      ...snapshot("0.18.0"), changelog: JSON.stringify([entry("0.18.0"), entry("0.18.0")]),
    })).toThrow(/duplicate entries/);
  });

  it("requires a new entry rather than reusing a future entry already on the target", () => {
    expect(() => validateRelease({ ...snapshot("0.17.1"), changelog: JSON.stringify([entry("0.18.0"), entry("0.17.1")]) }, snapshot("0.18.0"))).toThrow(/already exists on the target branch/);
  });

  it("requires the current version to be the newest changelog version", () => {
    expect(() => validateRelease(snapshot("0.17.1"), {
      ...snapshot("0.18.0"), changelog: JSON.stringify([entry("0.18.0"), entry("0.19.0")]),
    })).toThrow(/must be newer than 0.19.0/);
  });

  it.each([
    { ...entry("0.18.0"), date: "2026-02-30" },
    { ...entry("0.18.0"), summary: " " },
    { ...entry("0.18.0"), highlights: [] },
    { ...entry("0.18.0"), highlights: [" "] },
  ])("rejects an invalid new changelog entry", (newEntry) => {
    expect(() => validateRelease(snapshot("0.17.1"), { ...snapshot("0.18.0"), changelog: JSON.stringify([newEntry]) })).toThrow(/invalid/);
  });
});

describe("checkRelease git integration", () => {
  const temporaryRoots: string[] = [];
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("compares a real base commit with uncommitted release preparation", () => {
    const root = mkdtempSync(join(tmpdir(), "aproprose-release-check-"));
    temporaryRoots.push(root);
    mkdirSync(join(root, "src-tauri"));
    const git = (args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    const writeSnapshot = (version: string): void => {
      writeFileSync(join(root, "package.json"), JSON.stringify({ version }));
      writeFileSync(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version }));
      writeFileSync(join(root, "src-tauri/Cargo.toml"), `[package]\nname = "aproprose"\nversion = "${version}"\n`);
      writeFileSync(join(root, "src-tauri/Cargo.lock"), `[[package]]\nname = "other"\nversion = "9.9.9"\n\n[[package]]\nname = "aproprose"\nversion = "${version}"\n`);
      writeFileSync(join(root, "changelog.json"), JSON.stringify([entry(version)]));
    };
    git(["init", "--quiet"]);
    git(["config", "user.name", "Release Test"]);
    git(["config", "user.email", "release-test@example.invalid"]);
    writeSnapshot("0.17.1");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "base"]);
    const base = git(["rev-parse", "HEAD"]);
    writeSnapshot("0.18.0");
    expect(checkRelease({ root, baseRef: base })).toBe("0.18.0");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "next target"]);
    expect(() => checkRelease({ root, baseRef: "HEAD" })).toThrow(/Version must increase/);
  });
});
