import { describe, expect, it } from "vitest";
import { migrateV4 } from "@/lib/migration/v4/migrate";
import { metaBlobSchema } from "@/lib/migration/schema";

describe("migrateV4", () => {
  it("adds an empty story overview to existing project metadata", () => {
    const legacy = metaBlobSchema.parse({
      version: 3,
      characters: [],
      lore: [],
      statuses: {},
      outline: { premise: "A courier steals a royal secret." },
      chapters: {},
    });

    expect(migrateV4(legacy).outline).toEqual({
      premise: "A courier steals a royal secret.",
      overview: "",
    });
  });
});
