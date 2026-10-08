import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { StateStorage } from "zustand/middleware";
import { toast } from "sonner";

interface StorageIssueState {
  issues: Record<string, string>;
}

export const useStorageIssueStore = create<StorageIssueState>(() => ({ issues: {} }));

export const nativeStateStorage: StateStorage = {
  getItem: (name) => invoke<string | null>("read_app_data", { key: name }),
  setItem: (name, value) => invoke<void>("write_app_data", { key: name, value }),
  removeItem: (name) => invoke<void>("write_app_data", { key: name, value: "" }),
};

const previewStateStorage: StateStorage = {
  getItem: async () => null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
};

function reportStorageFailure(name: string, operation: string, error: unknown): void {
  const message = `${operation} failed for ${name}: ${String(error)}`;
  useStorageIssueStore.setState((state) => ({ issues: { ...state.issues, [name]: message } }));
  toast.error("Couldn't persist app settings", { description: message });
}

// Zustand setters intentionally return void. Observe write rejections here so
// fire-and-forget setters surface an issue without an unhandled promise.
export const tauriStateStorage: StateStorage = {
  getItem: async (name) => {
    if (!isTauri()) return previewStateStorage.getItem(name);
    try {
      return await nativeStateStorage.getItem(name);
    } catch (error) {
      reportStorageFailure(name, "Read", error);
      throw error;
    }
  },
  setItem: async (name, value) => {
    if (!isTauri()) return previewStateStorage.setItem(name, value);
    try {
      await nativeStateStorage.setItem(name, value);
    } catch (error) {
      reportStorageFailure(name, "Write", error);
    }
  },
  removeItem: async (name) => {
    if (!isTauri()) return previewStateStorage.removeItem(name);
    try {
      await nativeStateStorage.removeItem(name);
    } catch (error) {
      reportStorageFailure(name, "Remove", error);
    }
  },
};
