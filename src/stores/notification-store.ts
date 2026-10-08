import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { z } from "zod";
import {
  notificationKey,
  notificationSchema,
  type AppNotification,
  type NotificationInput,
} from "@/lib/notification-model";
import { tauriStateStorage } from "@/lib/storage";

export function serializedNotificationStorage(
  storage: StateStorage,
): StateStorage {
  let pending: Promise<void> = Promise.resolve();
  return {
    ...storage,
    setItem: (name, value) => {
      const write = async (): Promise<void> => {
        await storage.setItem(name, value);
      };
      pending = pending.then(write, (error: unknown) => {
        console.warn("Retrying notification history write after failure", {
          error,
        });
        return write();
      });
      return pending;
    },
  };
}

const notificationStorage = serializedNotificationStorage(tauriStateStorage);
const MAX_NOTIFICATIONS = 100;
interface NotificationState {
  notifications: AppNotification[];
  record: (input: NotificationInput) => void;
  resolve: (id: string) => void;
}
const persistedSchema = z.object({
  notifications: z.array(notificationSchema),
});

export function mergeNotifications(
  persisted: unknown,
  current: NotificationState,
): NotificationState {
  if (persisted === undefined) return current;
  const parsed = persistedSchema.parse(persisted);
  const byKey = new Map(
    parsed.notifications.map((item) => [notificationKey(item), item]),
  );
  for (const item of current.notifications) {
    const key = notificationKey(item);
    const stored = byKey.get(key);
    byKey.set(
      key,
      stored === undefined
        ? item
        : {
            ...item,
            firstAt: Math.min(stored.firstAt, item.firstAt),
            occurrences: stored.occurrences + item.occurrences,
          },
    );
  }
  return {
    ...current,
    notifications: [...byKey.values()]
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, MAX_NOTIFICATIONS),
  };
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      notifications: [],
      record: (input) =>
        set((state) => {
          const id = notificationKey(input);
          const existing = state.notifications.find((item) => item.id === id);
          const now = Date.now();
          const notification: AppNotification = {
            ...input,
            id,
            firstAt: existing === undefined ? now : existing.firstAt,
            lastAt: now,
            occurrences: existing === undefined ? 1 : existing.occurrences + 1,
            resolvedAt: null,
          };
          return {
            notifications: [
              notification,
              ...state.notifications.filter((item) => item.id !== id),
            ].slice(0, MAX_NOTIFICATIONS),
          };
        }),
      resolve: (id) =>
        set((state) => ({
          notifications: state.notifications.map((item) =>
            item.id === id ? { ...item, resolvedAt: Date.now() } : item,
          ),
        })),
    }),
    {
      name: "notifications",
      storage: createJSONStorage(() => notificationStorage),
      partialize: ({ notifications }) => ({ notifications }),
      merge: mergeNotifications,
      onRehydrateStorage: () => (state, error) => {
        if (error !== undefined) {
          console.error("Notification history could not be loaded", { error });
          return;
        }
        if (state !== undefined) {
          useNotificationStore.setState({ notifications: state.notifications });
        }
      },
    },
  ),
);
