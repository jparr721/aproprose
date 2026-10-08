// changelog-list.tsx - the browsable changelog body: an optional incoming-version
// callout followed by the full bundled history. Rendered by the What's New dialog and
// the settings About tab; the parent owns scrolling. Presentational - logic lives in
// lib/changelog + the changelog store.

import {
  TypographyH3,
  TypographyMuted,
  TypographyP,
} from "@/components/ui/typography";
import { CHANGELOG, type ChangelogEntry } from "@/lib/changelog";
import type { IncomingVersion } from "@/stores/changelog-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    <Card className="gap-2 py-3">
      <CardHeader className="px-3">
        <CardTitle>Coming in this update</CardTitle>
      </CardHeader>
      <CardContent className="px-3">
      {isEmpty ? (
        <TypographyMuted>No release notes for v{incoming.version}.</TypographyMuted>
      ) : (
        <EntryView version={incoming.version} date={null} summary={summary} highlights={highlights} />
      )}
      </CardContent>
    </Card>
  );
}

export function ChangelogList({ incoming }: { incoming: IncomingVersion | null }) {
  return (
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
  );
}
