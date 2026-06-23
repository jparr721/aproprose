import { test, expect } from "bun:test";
import { backupMessage, outcomeToStatus } from "./messages";

test("backupMessage embeds a readable timestamp", () => {
  const msg = backupMessage(new Date("2026-06-22T14:30:00"));
  expect(msg.startsWith("Backup —")).toBe(true);
  expect(msg.length).toBeGreaterThan("Backup —".length + 3);
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
