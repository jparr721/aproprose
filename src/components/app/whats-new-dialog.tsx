// whats-new-dialog.tsx - the browsable changelog, opened from the update toast's
// "See changes" (with incoming notes) and the macOS "What's New" menu item
// (show-whats-new event). Renders the incoming version first, then the full bundled
// history via ChangelogList. Presentational glue - logic lives in lib/changelog + the store.

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChangelogList } from "@/components/app/changelog-list";
import { useChangelogStore } from "@/stores/changelog-store";

export function WhatsNewDialog() {
  const isOpen = useChangelogStore((s) => s.isOpen);
  const incoming = useChangelogStore((s) => s.incoming);
  const close = useChangelogStore((s) => s.close);
  const open = useChangelogStore((s) => s.open);

  useEffect(() => {
    // "show-whats-new" is emitted by the native menu, so only listen when the Tauri
    // runtime is present. That covers the production app and the dev desktop app
    // (just run); it skips only the pure browser preview (just dev), where the full
    // changelog is read inline in settings > About instead. import.meta.env.DEV would
    // wrongly disable the menu in `just run` too, since that also runs under Vite's dev server.
    if (!isTauri()) return;
    const unlisten = listen("show-whats-new", () => open(null));
    unlisten.catch((e) => console.error("failed to register show-whats-new listener:", e));
    return () => {
      void unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [open]);

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>What's New</DialogTitle>
          <DialogDescription>Recent changes to aproprose.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <ChangelogList incoming={incoming} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
