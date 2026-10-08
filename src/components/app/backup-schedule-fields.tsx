import { useId, type ReactNode } from "react";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

interface BackupScheduleFieldsProps {
  autoSync: boolean;
  intervalMinutes: number;
  available: boolean;
  onAutoSyncChange: (enabled: boolean) => void;
  onIntervalChange: (minutes: number) => void;
}

export function BackupScheduleFields({
  autoSync,
  intervalMinutes,
  available,
  onAutoSyncChange,
  onIntervalChange,
}: BackupScheduleFieldsProps): ReactNode {
  const switchId = useId();
  const intervalLabelId = useId();
  const intervalDescriptionId = useId();
  return (
    <div className="flex flex-col gap-4">
      <Field orientation="horizontal">
        <FieldLabel htmlFor={switchId}>Auto-sync this project</FieldLabel>
        <Switch
          id={switchId}
          checked={autoSync}
          disabled={!available}
          onCheckedChange={onAutoSyncChange}
        />
      </Field>
      <Field>
        <FieldLabel id={intervalLabelId}>Backup interval</FieldLabel>
        <FieldDescription id={intervalDescriptionId}>
          Every {intervalMinutes} min
        </FieldDescription>
        <Slider
          aria-labelledby={intervalLabelId}
          aria-describedby={intervalDescriptionId}
          min={1}
          max={60}
          step={1}
          value={[intervalMinutes]}
          disabled={!available || !autoSync}
          onValueChange={([minutes]) => onIntervalChange(minutes)}
        />
      </Field>
    </div>
  );
}
