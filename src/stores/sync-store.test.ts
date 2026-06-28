import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Tauri APIs before importing the store.
vi.mock("@/lib/tauri", () => ({
  gitRepoStatus: vi.fn(),
  syncProject: vi.fn(),
  readAppData: vi.fn().mockResolvedValue(null),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

import { useSyncStore, STATUS_POLL_MS } from "@/stores/sync-store";
import { gitRepoStatus, syncProject } from "@/lib/tauri";
import type { RepoStatus } from "@/lib/types";

const CLEAN: RepoStatus = {
  isRepo: true,
  hasRemote: true,
  remoteUrl: "https://github.com/me/book",
  branch: "main",
  ahead: 0,
  behind: 0,
  dirty: false,
  changedFiles: [],
  conflictedFiles: [],
};

const DIRTY: RepoStatus = {
  ...CLEAN,
  dirty: true,
  changedFiles: [{ path: "content/ch1.tex", status: " M", conflicted: false }],
};

beforeEach(() => {
  vi.useFakeTimers();
  useSyncStore.getState().teardown();
  vi.mocked(gitRepoStatus).mockReset();
});

afterEach(() => {
  useSyncStore.getState().teardown();
  vi.useRealTimers();
});

describe("local status polling", () => {
  it("polls git status on an interval after init, flipping clean -> dirty with no manual check", async () => {
    vi.mocked(gitRepoStatus).mockResolvedValue(CLEAN);
    await useSyncStore.getState().init("/repo");
    expect(useSyncStore.getState().status).toBe("clean");
    const callsAfterInit = vi.mocked(gitRepoStatus).mock.calls.length;

    // The working tree changes on disk (the user edits) - no manual refresh.
    vi.mocked(gitRepoStatus).mockResolvedValue(DIRTY);
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS);

    expect(vi.mocked(gitRepoStatus).mock.calls.length).toBeGreaterThan(callsAfterInit);
    expect(useSyncStore.getState().status).toBe("dirty");
    expect(useSyncStore.getState().changedFiles).toHaveLength(1);
  });

  it("keeps array references stable across a no-op poll (no spurious re-render)", async () => {
    vi.mocked(gitRepoStatus).mockResolvedValue(CLEAN);
    await useSyncStore.getState().init("/repo");
    const before = useSyncStore.getState().conflictedFiles;

    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS);

    expect(useSyncStore.getState().conflictedFiles).toBe(before);
  });

  it("skips the poll while a sync is in flight (no double-read)", async () => {
    vi.mocked(gitRepoStatus).mockResolvedValue(CLEAN);
    await useSyncStore.getState().init("/repo");
    const before = vi.mocked(gitRepoStatus).mock.calls.length;

    useSyncStore.setState({ inFlight: true });
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS);

    expect(vi.mocked(gitRepoStatus).mock.calls.length).toBe(before);
  });

  it("stops polling after teardown (no leaked interval)", async () => {
    vi.mocked(gitRepoStatus).mockResolvedValue(CLEAN);
    await useSyncStore.getState().init("/repo");

    useSyncStore.getState().teardown();
    const before = vi.mocked(gitRepoStatus).mock.calls.length;
    await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 3);

    expect(vi.mocked(gitRepoStatus).mock.calls.length).toBe(before);
  });
});

describe("a status read racing a concurrent sync (must not clobber the sync's result)", () => {
  it("does not overwrite the synced status with a stale pre-sync snapshot", async () => {
    vi.mocked(gitRepoStatus).mockResolvedValue(CLEAN);
    await useSyncStore.getState().init("/repo");

    // A status read starts and suspends mid-read (it captured a pre-sync dirty tree).
    let releaseRead!: (v: RepoStatus) => void;
    vi.mocked(gitRepoStatus).mockReturnValueOnce(
      new Promise<RepoStatus>((res) => {
        releaseRead = res;
      }),
    );
    const staleRead = useSyncStore.getState().refreshStatus();

    // A sync completes to "synced" while that read is still in flight.
    vi.mocked(syncProject).mockResolvedValue({ kind: "synced" });
    await useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().status).toBe("synced");

    // The stale read resolves with its now-obsolete dirty snapshot.
    releaseRead(DIRTY);
    await staleRead;

    expect(useSyncStore.getState().status).toBe("synced");
  });

  it("does not clear conflictedFiles a sync just set (would re-enable editing a conflicted file)", async () => {
    const CONFLICTED: RepoStatus = {
      ...CLEAN,
      dirty: true,
      changedFiles: [{ path: "content/ch1.tex", status: "UU", conflicted: true }],
      conflictedFiles: ["content/ch1.tex"],
    };
    vi.mocked(gitRepoStatus).mockResolvedValue(CLEAN);
    await useSyncStore.getState().init("/repo");

    let releaseRead!: (v: RepoStatus) => void;
    vi.mocked(gitRepoStatus).mockReturnValueOnce(
      new Promise<RepoStatus>((res) => {
        releaseRead = res;
      }),
    );
    // syncNow's own post-sync read sees the conflicted tree on disk.
    vi.mocked(gitRepoStatus).mockResolvedValue(CONFLICTED);
    const staleRead = useSyncStore.getState().refreshStatus();

    vi.mocked(syncProject).mockResolvedValue({ kind: "conflict", files: ["content/ch1.tex"] });
    await useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().status).toBe("conflict");
    expect(useSyncStore.getState().conflictedFiles).toEqual(["content/ch1.tex"]);

    // The stale read (captured before the merge, so no conflict) resolves.
    releaseRead(CLEAN);
    await staleRead;

    expect(useSyncStore.getState().status).toBe("conflict");
    expect(useSyncStore.getState().conflictedFiles).toEqual(["content/ch1.tex"]);
  });
});
