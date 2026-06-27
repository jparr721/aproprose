// Mounts the self-update flow: an auto-check on launch and a manual check when
// the macOS application menu emits `check-for-updates`. Renders nothing - all
// user-facing output goes through the global sonner Toaster. The decision logic
// lives in `@/lib/updater`; this file only supplies the real side effects.

import { useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  runUpdateFlow,
  type AvailableUpdate,
  type UpdateFlowDeps,
} from "@/lib/updater";

const UPDATE_TOAST_ID = "app-update";

function buildDeps(): UpdateFlowDeps {
  // Keep the live Update handle from check() so install() acts on the same
  // object the user was prompted about.
  let handle: Update | null = null;

  return {
    isDev: import.meta.env.DEV,
    check: async () => {
      handle = await check();
      if (handle === null) return null;
      return { currentVersion: handle.currentVersion, version: handle.version };
    },
    promptToInstall: (update: AvailableUpdate) =>
      new Promise<boolean>((resolve) => {
        toast("New update available", {
          id: UPDATE_TOAST_ID,
          description: `v${update.currentVersion} -> v${update.version}`,
          duration: Infinity,
          closeButton: true,
          action: {
            label: "Update",
            onClick: () => resolve(true),
          },
          onDismiss: () => resolve(false),
        });
      }),
    install: async () => {
      if (handle === null) throw new Error("No update available to install");
      toast.loading("Downloading update", { id: UPDATE_TOAST_ID });
      await handle.downloadAndInstall();
      await relaunch();
    },
    notifyUpToDate: () => {
      toast.success("You are on the latest version");
    },
    notifyError: (error: unknown) => {
      toast.error("Update failed", {
        id: UPDATE_TOAST_ID,
        description: String(error),
      });
    },
  };
}

export function UpdateChecker(): null {
  useEffect(() => {
    // Skip in dev (`just dev` browser has no Tauri IPC; `just run` cannot apply
    // updates anyway). Production bundles run the full flow.
    if (import.meta.env.DEV) return;

    void runUpdateFlow("auto", buildDeps());

    const unlisten = listen("check-for-updates", () => {
      void runUpdateFlow("manual", buildDeps());
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  return null;
}
