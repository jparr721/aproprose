import { test, expect } from "bun:test";
import { pathHash } from "./path-hash";

test("pathHash is stable and deterministic", () => {
  expect(pathHash("/home/u/book")).toBe(pathHash("/home/u/book"));
});

test("pathHash differs for different paths", () => {
  expect(pathHash("/home/u/book")).not.toBe(pathHash("/home/u/other"));
});

test("pathHash is a hex string", () => {
  expect(pathHash("/x")).toMatch(/^[0-9a-f]+$/);
});
