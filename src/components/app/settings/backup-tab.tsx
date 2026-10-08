import { reportNotification } from "@/lib/notifications";
import { useEffect, useState } from "react";
import { BackupScheduleFields } from "@/components/app/backup-schedule-fields";
import {
  TypographyInlineCode,
  TypographyMuted,
} from "@/components/ui/typography";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { useSyncStore } from "@/stores/sync-store";
import { gitToolingStatus } from "@/lib/tauri";
import type { ToolingStatus } from "@/lib/types";

function ToolingNotice({ tooling }: { tooling: ToolingStatus | null }) {
  if (!tooling) return null;
  const cls = "text-xs";
  if (!tooling.gitInstalled) {
    return <TypographyMuted className={cls}>git isn't installed - backup is unavailable.</TypographyMuted>;
  }
  if (!tooling.ghInstalled) {
    return (
      <TypographyMuted className={cls}>
        The GitHub CLI (gh) isn't installed - creating repos and name checks need it.
      </TypographyMuted>
    );
  }
  if (!tooling.ghAuthed) {
    return (
      <TypographyMuted className={cls}>
        Not signed in to GitHub - run <TypographyInlineCode>gh auth login</TypographyInlineCode>.
      </TypographyMuted>
    );
  }
  return (
    <TypographyMuted className={cls}>
      Signed in as {tooling.login ?? "-"}.
    </TypographyMuted>
  );
}

export function BackupTab() {
  const autoSync = useSyncStore((s) => s.autoSync);
  const intervalMinutes = useSyncStore((s) => s.intervalMinutes);
  const isRepo = useSyncStore((s) => s.isRepo);
  const setAutoSync = useSyncStore((s) => s.setAutoSync);
  const setIntervalMinutes = useSyncStore((s) => s.setIntervalMinutes);
  const [tooling, setTooling] = useState<ToolingStatus | null>(null);

  useEffect(() => {
    void gitToolingStatus()
      .then(setTooling)
      .catch((e) => {
        console.error("Git tooling status failed", { error: e });
        reportNotification({ type: "backup-status", source: "Backup", projectRoot: null, provider: null });
        setTooling(null);
      });
  }, []);

  return (
    <FieldSet>
      <FieldLegend>Backup &amp; sync</FieldLegend>
      <ToolingNotice tooling={tooling} />

      <BackupScheduleFields autoSync={autoSync} intervalMinutes={intervalMinutes} available={isRepo} onAutoSyncChange={setAutoSync} onIntervalChange={setIntervalMinutes} />
    </FieldSet>
  );
}
