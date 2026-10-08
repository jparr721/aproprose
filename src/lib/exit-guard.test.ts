import { describe, expect, it, vi } from "vitest";
import { saveBeforeExit, type SaveBeforeExitDeps } from "@/lib/exit-guard";

function makeDeps(overrides: Partial<SaveBeforeExitDeps>): SaveBeforeExitDeps {
  return {
    hasUnsavedChanges: vi.fn(() => false),
    isCurrent: vi.fn(() => true),
    saveChanges: vi.fn(async () => ({ status: "clean" as const })),
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
        return { status: "saved" as const };
      }),
    });
    await expect(saveBeforeExit(deps)).resolves.toBe(true);
    expect(deps.saveChanges).toHaveBeenCalledOnce();
  });

  it("blocks exit when save failed even if another lifecycle is clean", async () => {
    const deps = makeDeps({ hasUnsavedChanges: () => true, saveChanges: async () => ({ status: "failed", message: "disk full" }) });
    await expect(saveBeforeExit(deps)).resolves.toBe(false);
  });

  it("blocks exit after ownership changes while saving", async () => {
    let current = true;
    let dirty = true;
    const deps = makeDeps({
      hasUnsavedChanges: () => dirty,
      isCurrent: () => current,
      saveChanges: async () => {
        current = false;
        dirty = false;
        return { status: "saved" };
      },
    });
    await expect(saveBeforeExit(deps)).resolves.toBe(false);
  });

  it("blocks exit when saving does not clear unsaved changes", async () => {
    const deps = makeDeps({
      hasUnsavedChanges: vi.fn(() => true),
    });
    await expect(saveBeforeExit(deps)).resolves.toBe(false);
    expect(deps.saveChanges).toHaveBeenCalledOnce();
  });
});
