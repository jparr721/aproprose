// new-novel-dialog.tsx — scaffold a new managed novel: name, author, location.

import { useState } from "react";
import { IconFolder } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { pickProjectDir } from "@/lib/tauri";
import { useProjectStore } from "@/stores/project-store";

export function NewNovelDialog({ trigger }: { trigger: React.ReactNode }) {
  const createProject = useProjectStore((s) => s.createProject);
  const loading = useProjectStore((s) => s.status === "loading");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const [location, setLocation] = useState<string | null>(null);

  const ready = name.trim().length > 0 && location != null;

  const chooseLocation = async () => {
    const dir = await pickProjectDir();
    if (dir) setLocation(dir);
  };

  const submit = async () => {
    if (!ready || location == null) return;
    await createProject(location, name.trim(), author.trim());
    setOpen(false);
    setName("");
    setAuthor("");
    setLocation(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="font-sans sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">New novel</DialogTitle>
          <DialogDescription>
            Scaffolds a LaTeX book from the template. You can edit author, ISBN, and
            more later in Project settings.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="novel-name">Title</Label>
            <Input
              id="novel-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="Novel title"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="novel-author">Author</Label>
            <Input
              id="novel-author"
              value={author}
              onChange={(e) => setAuthor(e.currentTarget.value)}
              placeholder="Author name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Location</Label>
            <Button
              type="button"
              variant="outline"
              className="justify-start font-normal"
              onClick={chooseLocation}
            >
              <IconFolder />
              <span className="truncate">{location ?? "Choose a folder…"}</span>
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!ready || loading}>
            {loading ? <Spinner /> : null}
            {loading ? "Creating" : "Create novel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
