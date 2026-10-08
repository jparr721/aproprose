import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  notificationKey,
  type NotificationInput,
} from "@/lib/notification-model";
import {
  mergeNotifications,
  serializedNotificationStorage,
  useNotificationStore,
} from "@/stores/notification-store";
import { reportAiError } from "@/lib/notifications";

const input: NotificationInput = {
  type: "ai-key-rejected",
  source: "Story refresh",
  projectRoot: "/book",
  provider: "openai",
};
beforeEach(() => {
  useNotificationStore.setState({ notifications: [] });
  vi.restoreAllMocks();
});

describe("notification history", () => {
  it("groups the same type and context, counts occurrences, and reopens resolved issues", () => {
    const store = useNotificationStore.getState();
    store.record(input);
    store.resolve(notificationKey(input));
    expect(
      useNotificationStore.getState().notifications[0].resolvedAt,
    ).not.toBeNull();
    store.record(input);
    expect(useNotificationStore.getState().notifications).toMatchObject([
      { type: "ai-key-rejected", occurrences: 2, resolvedAt: null },
    ]);
  });

  it("keeps different types, providers, projects, and sources separate", () => {
    for (const item of [
      input,
      { ...input, type: "ai-rate-limit" },
      { ...input, provider: "openrouter" },
      { ...input, projectRoot: "/other" },
      { ...input, source: "AI console" },
    ] satisfies NotificationInput[]) {
      useNotificationStore.getState().record(item);
    }
    expect(useNotificationStore.getState().notifications).toHaveLength(5);
  });

  it("keeps the latest 100 distinct issues", () => {
    for (let index = 0; index < 105; index += 1)
      useNotificationStore
        .getState()
        .record({ ...input, projectRoot: `/book-${index}` });
    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(100);
    expect(notifications[0].projectRoot).toBe("/book-104");
    expect(notifications[99].projectRoot).toBe("/book-5");
  });

  it("retains restored history and failures reported during async hydration", () => {
    useNotificationStore.getState().record(input);
    const saved = {
      notifications: useNotificationStore.getState().notifications,
    };
    useNotificationStore.setState({ notifications: [] });
    useNotificationStore.getState().record(input);
    useNotificationStore.getState().record({ ...input, type: "ai-rate-limit" });
    const merged = mergeNotifications(
      JSON.parse(JSON.stringify(saved)),
      useNotificationStore.getState(),
    );
    expect(merged.notifications).toHaveLength(2);
    expect(
      merged.notifications.find((item) => item.type === input.type)
        ?.occurrences,
    ).toBe(2);
  });

  it("validates restored types and accepts an absent first-run history", () => {
    const current = useNotificationStore.getState();
    expect(mergeNotifications(undefined, current)).toBe(current);
    expect(() =>
      mergeNotifications({ notifications: [{ type: "invented" }] }, current),
    ).toThrow();
  });

  it("stores actionable classification without raw responses or keys", () => {
    reportAiError(
      Object.assign(new Error("User not found sk-private-key"), {
        statusCode: 401,
        responseBody: '{"secret":"sk-private-key"}',
      }),
      "openrouter",
      "Story refresh",
      "/book",
      null,
    );
    const saved = JSON.stringify(useNotificationStore.getState().notifications);
    expect(saved).toContain("ai-key-rejected");
    expect(saved).not.toContain("sk-private-key");
    expect(saved).not.toContain("User not found");
  });
});

it("persists the merged history after a notification arrives during hydration", async () => {
  const original = useNotificationStore.persist.getOptions().storage;
  if (original === undefined) throw new Error("Notification storage missing");
  useNotificationStore.getState().record({ ...input, projectRoot: "/old" });
  const saved = {
    state: { notifications: useNotificationStore.getState().notifications },
    version: 0,
  };
  useNotificationStore.setState({ notifications: [] });
  let finishRead!: (value: typeof saved) => void;
  const read = new Promise<typeof saved>((resolve) => {
    finishRead = resolve;
  });
  let disk = saved;
  useNotificationStore.persist.setOptions({
    storage: {
      getItem: () => read,
      setItem: (_name, value) => {
        disk = value;
      },
      removeItem: () => undefined,
    },
  });
  try {
    const hydration = useNotificationStore.persist.rehydrate();
    useNotificationStore.getState().record({ ...input, projectRoot: "/new" });
    finishRead(saved);
    await hydration;
    expect(disk.state.notifications.map((item) => item.projectRoot)).toEqual(
      expect.arrayContaining(["/new", "/old"]),
    );
    expect(disk.state.notifications).toHaveLength(2);
    const afterRestart = structuredClone(disk);
    useNotificationStore.setState({ notifications: [] });
    useNotificationStore.persist.setOptions({
      storage: {
        getItem: () => afterRestart,
        setItem: (_name, value) => {
          disk = value;
        },
        removeItem: () => undefined,
      },
    });
    await useNotificationStore.persist.rehydrate();
    expect(useNotificationStore.getState().notifications).toHaveLength(2);
  } finally {
    useNotificationStore.persist.setOptions({ storage: original });
  }
});

it("serializes writes so an older slow snapshot cannot overwrite a newer one", async () => {
  let finishOld!: () => void;
  const oldWrite = new Promise<void>((resolve) => {
    finishOld = resolve;
  });
  let disk = "";
  const storage = serializedNotificationStorage({
    getItem: () => null,
    removeItem: () => undefined,
    setItem: async (_name, value) => {
      if (value === "old") await oldWrite;
      disk = value;
    },
  });
  const older = storage.setItem("notifications", "old");
  const newer = storage.setItem("notifications", "new");
  await Promise.resolve();
  expect(disk).toBe("");
  finishOld();
  await Promise.all([older, newer]);
  expect(disk).toBe("new");
});
