import { describe, expect, it } from "vitest";
import { queueProjectOperation } from "@/lib/project-operations";

describe("project disk ordering", () => {
  it("holds sync behind an unfinished save for the same root", async () => {
    let finishSave!: () => void;
    const order: string[] = [];
    const save = queueProjectOperation("/ordered", async () => {
      order.push("save");
      await new Promise<void>((resolve) => { finishSave = resolve; });
    });
    const sync = queueProjectOperation("/ordered", async () => { order.push("sync"); });
    await Promise.resolve();
    expect(order).toEqual(["save"]);
    finishSave();
    await Promise.all([save, sync]);
    expect(order).toEqual(["save", "sync"]);
  });

  it("allows another root to progress after a failed queued operation", async () => {
    const failure = queueProjectOperation("/failed", async () => { throw new Error("disk full"); });
    const observed = failure.catch((error: unknown) => error);
    const next = queueProjectOperation("/failed", async () => "recovered");
    const other = queueProjectOperation("/other", async () => "independent");
    expect(await observed).toBeInstanceOf(Error);
    await expect(next).resolves.toBe("recovered");
    await expect(other).resolves.toBe("independent");
  });
});
