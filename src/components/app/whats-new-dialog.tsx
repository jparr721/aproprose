// whats-new-dialog.tsx - the browsable changelog. Opened from the update toast's
// "See changes" (with incoming notes), the settings entry, or the macOS "What's New"
// menu item (show-whats-new event). Renders the incoming version first, then the
// full bundled history. Presentational glue - logic lives in lib/changelog + the store.

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TypographyH3, TypographyMuted, TypographyP } from "@/components/ui/typography";
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
  highlights: string[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <TypographyH3>{version}</TypographyH3>
        {date ? (
          <TypographyMuted className="font-sans text-xs tabular-nums">{date}</TypographyMuted>
        ) : null}
      </div>
      {summary ? <TypographyP className="mt-0">{summary}</TypographyP> : null}
      <ul className="ml-5 list-disc font-serif text-sm leading-relaxed marker:text-muted-foreground">
        {highlights.map((h, i) => (
          <li key={i}>{h}</li>
        ))}
      </ul>
    </section>
  );
}

function IncomingSection({ incoming }: { incoming: IncomingVersion }) {
  const { summary, highlights } = incoming.notes;
  if (summary === "" && highlights.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
      <TypographyMuted className="font-sans text-xs uppercase tracking-wide">
        Coming in this update
      </TypographyMuted>
      <EntryView
        version={incoming.version}
        date={null}
        summary={summary}
        highlights={highlights}
      />
    </div>
  );
}

export function WhatsNewDialog() {
  const isOpen = useChangelogStore((s) => s.isOpen);
  const incoming = useChangelogStore((s) => s.incoming);
  const close = useChangelogStore((s) => s.close);
  const open = useChangelogStore((s) => s.open);

  useEffect(() => {
    // The native menu only exists in the desktop app; skip the IPC listen in the
    // browser dev server (just dev), where the settings button still drives the store.
    if (import.meta.env.DEV) return;
    const unlisten = listen("show-whats-new", () => open(null));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [open]);

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[80vh] font-sans sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading">What's New</DialogTitle>
          <DialogDescription>Recent changes to aproprose.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
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
