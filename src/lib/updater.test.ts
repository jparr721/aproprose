import { describe, it, expect, vi } from "vitest";
import { runUpdateFlow, type UpdateFlowDeps, type AvailableUpdate } from "@/lib/updater";

const UPDATE: AvailableUpdate = { currentVersion: "0.3.0", version: "0.4.0", body: "" };

function makeDeps(overrides: Partial<UpdateFlowDeps>): UpdateFlowDeps {
  return {
    isDev: false,
    check: vi.fn(async () => null),
    install: vi.fn(async () => {}),
    promptToInstall: vi.fn(async () => false),
    notifyUpToDate: vi.fn(),
    notifyError: vi.fn(),
    ...overrides,
  };
}

describe("runUpdateFlow", () => {
  it("does nothing in dev mode", async () => {
    const deps = makeDeps({ isDev: true });
    await runUpdateFlow("auto", deps);
    expect(deps.check).not.toHaveBeenCalled();
    expect(deps.promptToInstall).not.toHaveBeenCalled();
  });

  it("auto: stays silent when already up to date", async () => {
    const deps = makeDeps({ check: vi.fn(async () => null) });
    await runUpdateFlow("auto", deps);
    expect(deps.notifyUpToDate).not.toHaveBeenCalled();
    expect(deps.promptToInstall).not.toHaveBeenCalled();
  });

  it("manual: reports when already up to date", async () => {
    const deps = makeDeps({ check: vi.fn(async () => null) });
    await runUpdateFlow("manual", deps);
    expect(deps.notifyUpToDate).toHaveBeenCalledOnce();
  });

  it("installs when an update is available and the user confirms", async () => {
    const deps = makeDeps({
      check: vi.fn(async () => UPDATE),
      promptToInstall: vi.fn(async () => true),
    });
    await runUpdateFlow("auto", deps);
    expect(deps.promptToInstall).toHaveBeenCalledWith(UPDATE);
    expect(deps.install).toHaveBeenCalledWith(UPDATE);
  });

  it("does not install when the user dismisses the prompt", async () => {
    const deps = makeDeps({
      check: vi.fn(async () => UPDATE),
      promptToInstall: vi.fn(async () => false),
    });
    await runUpdateFlow("auto", deps);
    expect(deps.install).not.toHaveBeenCalled();
  });

  it("auto: stays silent when the check fails", async () => {
    const deps = makeDeps({
      check: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    await runUpdateFlow("auto", deps);
    expect(deps.notifyError).not.toHaveBeenCalled();
  });

  it("manual: reports when the check fails", async () => {
    const deps = makeDeps({
      check: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    await runUpdateFlow("manual", deps);
    expect(deps.notifyError).toHaveBeenCalledOnce();
  });

  it("reports when the install fails after the user confirms", async () => {
    const deps = makeDeps({
      check: vi.fn(async () => UPDATE),
      promptToInstall: vi.fn(async () => true),
      install: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });
    await runUpdateFlow("auto", deps);
    expect(deps.notifyError).toHaveBeenCalledOnce();
  });
});
