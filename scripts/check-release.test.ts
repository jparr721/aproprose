import { describe, expect, it } from "vitest";
import { checkRelease, type ReleaseFiles } from "./check-release";

function releaseFixture(version: string): ReleaseFiles {
  return {
    basePackageJson: JSON.stringify({ version: "0.17.1" }),
    packageJson: JSON.stringify({ version }),
    cargoToml: `[package]\nname = "aproprose"\nversion = "${version}"\n`,
    tauriConf: JSON.stringify({ version }),
    cargoLock: `[[package]]\nname = "aproprose"\nversion = "${version}"\n`,
    changelog: JSON.stringify([{
      version,
      date: "2026-10-07",
      summary: "Keep AI follow-ups visible.",
      highlights: ["Show compact tool activity while the agent works."],
    }]),
  };
}

describe("version and changelog gate", () => {
  it.each(["0.17.2", "0.18.0", "1.0.0"])("accepts a synchronized %s release", (version) => {
    expect(() => checkRelease(releaseFixture(version))).not.toThrow();
  });

  it.each(["0.17.1", "0.17.0"])("rejects a version that was not bumped: %s", (version) => {
    expect(() => checkRelease(releaseFixture(version))).toThrow(/bump.*version/i);
  });

  it.each(["cargoToml", "tauriConf", "cargoLock"] as const)("rejects an unsynchronized %s", (field) => {
    const files = releaseFixture("0.17.2");
    expect(() => checkRelease({ ...files, [field]: files[field].replace("0.17.2", "0.17.1") }))
      .toThrow(/must match package.json version 0.17.2/);
  });

  it("rejects a missing changelog entry", () => {
    expect(() => checkRelease({ ...releaseFixture("0.17.2"), changelog: "[]" })).toThrow();
  });

  it("requires the new version at the top of the changelog", () => {
    const files = releaseFixture("0.17.2");
    expect(() => checkRelease({ ...files, changelog: releaseFixture("0.17.1").changelog }))
      .toThrow(/first changelog entry must describe version 0.17.2/);
  });

  it.each([
    { date: "2026-02-30", summary: "A fix.", highlights: ["A change."] },
    { date: "2026-10-07", summary: " ", highlights: ["A change."] },
    { date: "2026-10-07", summary: "A fix.", highlights: [] },
    { date: "2026-10-07", summary: "A fix.", highlights: [" "] },
  ])("rejects an incomplete changelog entry: %j", (entry) => {
    expect(() => checkRelease({
      ...releaseFixture("0.17.2"),
      changelog: JSON.stringify([{ version: "0.17.2", ...entry }]),
    })).toThrow();
  });
});
