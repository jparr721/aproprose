import { describe, expect, it, vi } from "vitest";
import { saveBeforeExit, type SaveBeforeExitDeps } from "@/lib/exit-guard";

function makeDeps(overrides: Partial<SaveBeforeExitDeps>): SaveBeforeExitDeps {
  return {
    hasUnsavedChanges: vi.fn(() => false),
    saveChanges: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("saveBeforeExit", () => {
  it("allows exit when there are no unsaved changes", async () => {
    const deps = makeDeps({});
    await expect(saveBeforeExit(deps)).resolves.toBe(true);
    expect(deps.saveChanges).not.toHaveBeenCalled();
  });

  it("saves dirty changes before allowing exit", async () => {
    let dirty = true;
    const deps = makeDeps({
      hasUnsavedChanges: vi.fn(() => dirty),
      saveChanges: vi.fn(async () => {
        dirty = false;
      }),
    });
    await expect(saveBeforeExit(deps)).resolves.toBe(true);
    expect(deps.saveChanges).toHaveBeenCalledOnce();
  });

  it("blocks exit when saving does not clear unsaved changes", async () => {
    const deps = makeDeps({
      hasUnsavedChanges: vi.fn(() => true),
    });
    await expect(saveBeforeExit(deps)).resolves.toBe(false);
    expect(deps.saveChanges).toHaveBeenCalledOnce();
  });
});
