import { ChangelogList } from "@/components/app/changelog-list";
import {
  TypographyEyebrow,
  TypographyForeground,
} from "@/components/ui/typography";
import { CHANGELOG } from "@/lib/changelog";

// The release process bumps package.json/Cargo/tauri.conf and prepends a changelog entry
// for the same version in one step, so the newest entry is always the running version.
const APP_VERSION = CHANGELOG[0].version;

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <TypographyEyebrow>{label}</TypographyEyebrow>
      <TypographyForeground className="text-sm tabular-nums">{value}</TypographyForeground>
    </div>
  );
}

export function AboutTab() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
        <InfoRow label="Version" value={APP_VERSION} />
        <InfoRow label="License" value="-" />
      </div>
      <div className="flex flex-col gap-2">
        <TypographyEyebrow>Changelog</TypographyEyebrow>
        <ChangelogList incoming={null} />
      </div>
    </div>
  );
}
