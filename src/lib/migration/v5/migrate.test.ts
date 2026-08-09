import { describe, expect, it } from "vitest";
import { migrateV5 } from "@/lib/migration/v5/migrate";
import { metaBlobSchema } from "@/lib/migration/schema";

describe("migrateV5", () => {
  it("adds structured profiles and empty project knowledge", () => {
    const legacy = metaBlobSchema.parse({
      version: 4,
      characters: [
        { id: "c1", name: "Mara", color: "#336699", role: "Lead" },
      ],
      lore: [],
      statuses: {},
      outline: { premise: "A courier steals a secret.", overview: "" },
      chapters: {},
    });

    const migrated = migrateV5(legacy);

    expect(migrated.characters[0].profile).toEqual({
      appearance: "",
      mannerisms: "",
      motivations: "",
      relationships: "",
      history: "",
      voice: "",
    });
    expect(migrated.knowledge).toEqual({
      chapters: {},
      characterCandidates: [],
      acceptedCandidateFingerprints: [],
      dismissedCandidateFingerprints: [],
      appliedCharacterObservationIds: {},
    });
    expect(migrated.version).toBe(5);
  });
});
