import { test, expect } from "vitest";
import { backupMessage, deriveIdleStatus, outcomeMessage, outcomeToStatus } from "./messages";
import type { RepoStatus } from "@/lib/types";

test("backupMessage embeds the given date", () => {
  const d = new Date("2026-06-22T14:30:00");
  const msg = backupMessage(d);
  expect(msg.startsWith("Backup —")).toBe(true);
  expect(msg).toContain(d.toLocaleString());
});

test("outcomeToStatus maps each variant", () => {
  expect(outcomeToStatus({ kind: "clean" })).toBe("clean");
  expect(outcomeToStatus({ kind: "synced" })).toBe("synced");
  expect(outcomeToStatus({ kind: "conflict", files: ["a"] })).toBe("conflict");
  expect(outcomeToStatus({ kind: "pushRejected" })).toBe("dirty");
  expect(outcomeToStatus({ kind: "needsSetup", reason: "x" })).toBe("needsSetup");
  expect(outcomeToStatus({ kind: "authMissing" })).toBe("error");
  expect(outcomeToStatus({ kind: "offline" })).toBe("offline");
});

const baseStatus: RepoStatus = {
  isRepo: true, hasRemote: true, remoteUrl: "x", branch: "main",
  ahead: 0, behind: 0, dirty: false, changedFiles: [], conflictedFiles: [],
};

test("deriveIdleStatus precedence", () => {
  expect(deriveIdleStatus({ ...baseStatus, isRepo: false })).toBe("disabled");
  expect(deriveIdleStatus({ ...baseStatus, hasRemote: false })).toBe("disabled");
  expect(deriveIdleStatus({ ...baseStatus, conflictedFiles: ["a"], dirty: true })).toBe("conflict");
  expect(deriveIdleStatus({ ...baseStatus, dirty: true })).toBe("dirty");
  expect(deriveIdleStatus({ ...baseStatus, ahead: 2 })).toBe("dirty");
  expect(deriveIdleStatus(baseStatus)).toBe("clean");
});

test("outcomeMessage gives actionable text for failures and null for success", () => {
  expect(outcomeMessage({ kind: "clean" })).toBeNull();
  expect(outcomeMessage({ kind: "synced" })).toBeNull();
  expect(outcomeMessage({ kind: "authMissing" })).toContain("gh auth login");
  expect(outcomeMessage({ kind: "offline" })).not.toBeNull();
  expect(outcomeMessage({ kind: "pushRejected" })).not.toBeNull();
  expect(outcomeMessage({ kind: "needsSetup", reason: "no remote" })).toBe("no remote");
  expect(outcomeMessage({ kind: "conflict", files: ["a"] })).toContain("conflict");
});
