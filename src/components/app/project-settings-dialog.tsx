// project-settings-dialog.tsx — edit manuscript metadata (title/subtitle/author/
// publisher/ISBN). Saving regenerates metadata.tex via the store. Edition year is
// always the current year, so it isn't shown.

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NovelMetadata } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";

export function ProjectSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const metadata = useProjectStore((s) => s.project?.metadata);
  const updateMetadata = useProjectStore((s) => s.updateMetadata);
  const [form, setForm] = useState<NovelMetadata>(
    metadata ?? { title: "", subtitle: "", author: "", publisher: "", isbn: "" },
  );

  // Re-seed the form whenever the dialog opens or the project changes.
  useEffect(() => {
    if (open && metadata) setForm(metadata);
  }, [open, metadata]);

  const field = (key: keyof NovelMetadata) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.currentTarget.value }));

  const save = () => {
    void updateMetadata(form);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>
            These populate the title page, headers, and copyright page. Edition year
            is always the current year.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meta-title">Title</Label>
            <Input id="meta-title" value={form.title} onChange={field("title")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meta-subtitle">Subtitle</Label>
            <Input id="meta-subtitle" value={form.subtitle} onChange={field("subtitle")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meta-author">Author</Label>
            <Input id="meta-author" value={form.author} onChange={field("author")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meta-publisher">Publisher</Label>
            <Input id="meta-publisher" value={form.publisher} onChange={field("publisher")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meta-isbn">ISBN</Label>
            <Input id="meta-isbn" value={form.isbn} onChange={field("isbn")} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!form.title.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
