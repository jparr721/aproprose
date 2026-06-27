// whats-new-dialog.tsx - the browsable changelog. Opened from the update toast's
// "See changes" (with incoming notes), the settings entry, or the macOS "What's New"
// menu item (show-whats-new event). Renders the incoming version first, then the
// full bundled history. Presentational glue - logic lives in lib/changelog + the store.

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
import {
  TypographyEyebrow,
  TypographyH3,
  TypographyMuted,
  TypographyP,
} from "@/components/ui/typography";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";
import { useChangelogStore, type IncomingVersion } from "@/stores/changelog-store";

function EntryView({
  version,
  date,
  summary,
  highlights,
}: {
  version: string;
  date: string | null;
  summary: string;
  highlights: readonly string[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <TypographyH3>{version}</TypographyH3>
        {date ? <TypographyMuted>{date}</TypographyMuted> : null}
      </div>
      {summary ? <TypographyP className="mt-0">{summary}</TypographyP> : null}
      <ul className="ml-5 list-disc marker:text-muted-foreground">
        {highlights.map((h, i) => (
          <li key={i}>{h}</li>
        ))}
      </ul>
    </section>
  );
}

function IncomingSection({ incoming }: { incoming: IncomingVersion }) {
  const { summary, highlights } = incoming.notes;
  const isEmpty = summary === "" && highlights.length === 0;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
      <TypographyEyebrow>Coming in this update</TypographyEyebrow>
      {isEmpty ? (
        <TypographyMuted>No release notes for v{incoming.version}.</TypographyMuted>
      ) : (
        <EntryView version={incoming.version} date={null} summary={summary} highlights={highlights} />
      )}
    </div>
  );
}

export function WhatsNewDialog() {
  const isOpen = useChangelogStore((s) => s.isOpen);
  const incoming = useChangelogStore((s) => s.incoming);
  const close = useChangelogStore((s) => s.close);
  const open = useChangelogStore((s) => s.open);

  useEffect(() => {
    // "show-whats-new" is emitted by the native menu, so only listen when the Tauri
    // runtime is present. That covers the production app and the dev desktop app
    // (just run); it skips only the pure browser preview (just dev), where the settings
    // button drives the store directly. import.meta.env.DEV would wrongly disable the
    // menu in `just run` too, since that also runs under the Vite dev server.
    if (!isTauri()) return;
    const unlisten = listen("show-whats-new", () => open(null));
    unlisten.catch((e) => console.error("failed to register show-whats-new listener:", e));
    return () => {
      void unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [open]);

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>What's New</DialogTitle>
          <DialogDescription>Recent changes to aproprose.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6">
            {incoming ? <IncomingSection incoming={incoming} /> : null}
            {CHANGELOG.map((e: ChangelogEntry) => (
              <EntryView
                key={e.version}
                version={e.version}
                date={e.date}
                summary={e.summary}
                highlights={e.highlights}
              />
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
