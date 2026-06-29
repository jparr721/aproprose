import { describe, expect, it } from "vitest";
import { updateLore, removeLore } from "@/lib/lore/model";
import type { LoreEntry } from "@/lib/types";

const lore: LoreEntry[] = [
  { id: "l1", title: "Tile", description: "", characterIds: [], tags: [] },
  { id: "l2", title: "Sword", description: "A blade", characterIds: ["c1"], tags: ["weapon"] },
];

describe("updateLore", () => {
  it("applies patch to found entry", () => {
    const result = updateLore(lore, "l1", { title: "The Tile", description: "Ancient" });
    expect(result[0]).toMatchObject({ id: "l1", title: "The Tile", description: "Ancient" });
  });

  it("returns identical array when id not found", () => {
    const result = updateLore(lore, "nonexistent", { title: "X" });
    expect(result).toEqual(lore);
  });

  it("deduplicates tags", () => {
    const result = updateLore(lore, "l1", { tags: ["a", "a", "b"] });
    expect(result[0].tags).toEqual(["a", "b"]);
  });

  it("trims and filters blank tags", () => {
    const result = updateLore(lore, "l1", { tags: [" a ", "", "b"] });
    expect(result[0].tags).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const original = structuredClone(lore);
    updateLore(lore, "l1", { title: "New" });
    expect(lore).toEqual(original);
  });
});

describe("removeLore", () => {
  it("removes found entry", () => {
    const result = removeLore(lore, "l1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("l2");
  });

  it("returns identical array when id not found", () => {
    const result = removeLore(lore, "nonexistent");
    expect(result).toEqual(lore);
  });

  it("does not mutate the input array", () => {
    const original = structuredClone(lore);
    removeLore(lore, "l1");
    expect(lore).toEqual(original);
  });
});