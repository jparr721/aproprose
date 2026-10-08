import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("macOS traffic-light positioning", () => {
  it("ships the Tao fix that restores the inset after fullscreen and title changes", () => {
    const lock: string = readFileSync(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
    const version: RegExpMatchArray | null = lock.match(/\[\[package\]\]\nname = "tao"\nversion = "(\d+)\.(\d+)\.(\d+)"/);
    if (version === null) throw new Error("Cargo.lock must contain the Tao window runtime");

    // Tao 0.36.0 fixes tauri-apps/tauri#13044 and #15451.
    expect(Number(version[1]) > 0 || Number(version[2]) >= 36).toBe(true);
  });
});
