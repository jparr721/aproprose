import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppearanceTab } from "@/components/app/settings/appearance-tab";
import { AiTab } from "@/components/app/settings/ai-tab";
import { BackupTab } from "@/components/app/settings/backup-tab";
import { KeyboardTab } from "@/components/app/settings/keyboard-tab";
import { StatsTab } from "@/components/app/settings/stats-tab";
import { useKeybinding } from "@/hooks/use-keybinding";
import { KEYBINDING_IDS } from "@/lib/keybindings";
import {
  SETTINGS_TABS,
  type SettingsTab,
  useSettingsDialogStore,
} from "@/stores/settings-dialog-store";

export function SettingsDialog() {
  const open = useSettingsDialogStore((s) => s.open);
  const tab = useSettingsDialogStore((s) => s.tab);
  const setOpen = useSettingsDialogStore((s) => s.setOpen);
  const setTab = useSettingsDialogStore((s) => s.setTab);

  useKeybinding(KEYBINDING_IDS.TOGGLE_SETTINGS, () => {
    const s = useSettingsDialogStore.getState();
    s.setOpen(!s.open);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[80vh] flex-col gap-4 font-sans sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Appearance, AI, backup, and keyboard shortcuts.</DialogDescription>
        </DialogHeader>
        <Tabs
          className="min-h-0 flex-1 gap-4"
          orientation="vertical"
          value={tab}
          onValueChange={(v) => setTab(v as SettingsTab)}
        >
          <TabsList className="w-40 shrink-0" variant="line">
            <TabsTrigger value={SETTINGS_TABS.APPEARANCE}>Appearance</TabsTrigger>
            <TabsTrigger value={SETTINGS_TABS.AI}>AI</TabsTrigger>
            <TabsTrigger value={SETTINGS_TABS.BACKUP}>Backup</TabsTrigger>
            <TabsTrigger value={SETTINGS_TABS.KEYBOARD}>Keyboard</TabsTrigger>
            <TabsTrigger value={SETTINGS_TABS.STATS}>Stats</TabsTrigger>
          </TabsList>
          <TabsContent className="min-h-0 flex-1 outline-none" value={SETTINGS_TABS.APPEARANCE}>
            <ScrollArea className="h-full pr-4"><div className="p-1"><AppearanceTab /></div></ScrollArea>
          </TabsContent>
          <TabsContent className="min-h-0 flex-1 outline-none" value={SETTINGS_TABS.AI}>
            <ScrollArea className="h-full pr-4"><div className="p-1"><AiTab /></div></ScrollArea>
          </TabsContent>
          <TabsContent className="min-h-0 flex-1 outline-none" value={SETTINGS_TABS.BACKUP}>
            <ScrollArea className="h-full pr-4"><div className="p-1"><BackupTab /></div></ScrollArea>
          </TabsContent>
          <TabsContent className="min-h-0 flex-1 outline-none" value={SETTINGS_TABS.KEYBOARD}>
            <ScrollArea className="h-full pr-4"><div className="p-1"><KeyboardTab /></div></ScrollArea>
          </TabsContent>
          <TabsContent className="min-h-0 flex-1 outline-none" value={SETTINGS_TABS.STATS}>
            <ScrollArea className="h-full pr-4"><div className="p-1"><StatsTab /></div></ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
