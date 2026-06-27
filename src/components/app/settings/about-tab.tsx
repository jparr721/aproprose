import { Button } from "@/components/ui/button";
import { Field } from "@/components/app/settings/field";
import { useSettingsDialogStore } from "@/stores/settings-dialog-store";
import { useChangelogStore } from "@/stores/changelog-store";

export function AboutTab() {
  return (
    <Field label="About">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start font-sans"
        onClick={() => {
          useSettingsDialogStore.getState().setOpen(false);
          useChangelogStore.getState().open(null);
        }}
      >
        What's New
      </Button>
    </Field>
  );
}
