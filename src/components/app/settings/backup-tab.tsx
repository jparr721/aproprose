import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  TypographyForeground,
  TypographyMuted,
  TypographyMutedSpan,
} from "@/components/ui/typography";
import { Field } from "@/components/app/settings/field";
import { useSyncStore } from "@/stores/sync-store";
import { gitToolingStatus } from "@/lib/tauri";
import type { ToolingStatus } from "@/lib/types";

function ToolingNotice({ tooling }: { tooling: ToolingStatus | null }) {
  if (!tooling) return null;
  const cls = "font-sans text-xs";
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
        Not signed in to GitHub - run <span className="font-mono">gh auth login</span>.
      </TypographyMuted>
    );
  }
  return (
    <TypographyMuted className={cls}>
      Signed in as <span className="font-mono">{tooling.login ?? "-"}</span>.
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
        console.error("gitToolingStatus failed:", e);
        setTooling(null);
      });
  }, []);

  return (
    <Field label="Backup & sync">
      <ToolingNotice tooling={tooling} />

      <div className="flex items-center justify-between">
        <TypographyForeground className="font-sans text-sm">Auto-sync this project</TypographyForeground>
        <Switch checked={autoSync} disabled={!isRepo} onCheckedChange={setAutoSync} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <TypographyMutedSpan className="font-sans text-sm">Every</TypographyMutedSpan>
          <TypographyMutedSpan className="font-mono text-xs tabular-nums">{intervalMinutes} min</TypographyMutedSpan>
        </div>
        <Slider
          min={1}
          max={60}
          step={1}
          value={[intervalMinutes]}
          onValueChange={([v]) => setIntervalMinutes(v)}
          disabled={!autoSync || !isRepo}
        />
      </div>
    </Field>
  );
}
