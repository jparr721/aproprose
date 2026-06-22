// storage.ts — a zustand `StateStorage` backed by the Rust app-data commands.
//
// Persisted UI state (settings) lives in the app config dir via Rust, not in the
// webview's localStorage, so it survives reinstalls and stays off the user repo.
// Every call is wrapped so that running in a plain browser (`just dev`, no Tauri
// runtime) degrades to "no persistence" instead of throwing.

import { invoke } from "@tauri-apps/api/core";
import type { StateStorage } from "zustand/middleware";

export const tauriStateStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return (await invoke<string | null>("read_app_data", { key: name })) ?? null;
    } catch {
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      await invoke("write_app_data", { key: name, value });
    } catch {
      /* no Tauri runtime — skip */
    }
  },
  removeItem: async (name) => {
    try {
      await invoke("write_app_data", { key: name, value: "" });
    } catch {
      /* no Tauri runtime — skip */
    }
  },
};
