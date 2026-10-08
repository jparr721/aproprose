// backup-setup-dialog.tsx - two flows. For a git repo aproprose hasn't seen
// before: pick an auto-sync window or stay manual. For a project with no GitHub
// backup yet: name the repo + visibility, then create it and push.

import { notifyAppError } from "@/lib/notifications";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BackupScheduleFields } from "@/components/app/backup-schedule-fields";
import { Spinner } from "@/components/ui/spinner";
import { TypographyMuted } from "@/components/ui/typography";
import { useSyncStore } from "@/stores/sync-store";
import { useProjectStore } from "@/stores/project-store";
import { enableBackup, ghCheckRepoName } from "@/lib/tauri";
import { toast } from "sonner";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export function BackupSetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const root = useProjectStore((s) => s.project?.root ?? null);
  const projectName = useProjectStore((s) => s.project?.name ?? "");
  const isRepo = useSyncStore((s) => s.isRepo);
  const remoteUrl = useSyncStore((s) => s.remoteUrl);
  const autoSync = useSyncStore((s) => s.autoSync);
  const intervalMinutes = useSyncStore((s) => s.intervalMinutes);
  const setAutoSync = useSyncStore((s) => s.setAutoSync);
  const setIntervalMinutes = useSyncStore((s) => s.setIntervalMinutes);
  const init = useSyncStore((s) => s.init);

  const alreadyBackedUp = isRepo && !!remoteUrl;

  const [name, setName] = useState(() => slugify(projectName || "my-book"));
  const [isPrivate, setIsPrivate] = useState(true);
  const [creating, setCreating] = useState(false);

  const createRepo = async () => {
    if (!root || creating) return;
    setCreating(true);
    try {
      const check = await ghCheckRepoName(name);
      if (!check.available) {
        toast.error(check.reason ?? "That name isn't available");
        return;
      }
      const created = await enableBackup(root, name, isPrivate);
      toast.success(`Backed up to ${created.owner}/${name}`);
      await init(root); // re-detect: now a repo with a remote
      onOpenChange(false);
    } catch (e) {
      notifyAppError("backup-setup", "Backup", root, e);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {alreadyBackedUp ? (
          <>
            <DialogHeader>
              <DialogTitle>Set up backup</DialogTitle>
              <DialogDescription>
                This project is on GitHub. Keep it backed up automatically, or sync by hand.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-5 py-2">
              <BackupScheduleFields autoSync={autoSync} intervalMinutes={intervalMinutes} available={true} onAutoSyncChange={setAutoSync} onIntervalChange={setIntervalMinutes} />
              <div>
                <TypographyMuted className="text-xs">
                  When off, use "Sync now" to back up your work.
                </TypographyMuted>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Back up to GitHub</DialogTitle>
              <DialogDescription>
                Create a {isPrivate ? "private" : "public"} repository and push your book. Uses your local GitHub login.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="repo-name">Repository name</Label>
                <Input
                  id="repo-name"
                  value={name}
                  onChange={(e) => setName(slugify(e.currentTarget.value))}
                  className="font-mono"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="repo-private">Private</Label>
                <Switch id="repo-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => void createRepo()} disabled={!name || creating}>
                {creating ? <Spinner /> : null}
                Create &amp; back up
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
