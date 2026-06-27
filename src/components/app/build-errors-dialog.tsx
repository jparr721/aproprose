import { IconCopy } from "@tabler/icons-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { TypographyMuted } from "@/components/ui/typography";
import { useProjectStore } from "@/stores/project-store";
import { copyText } from "@/lib/clipboard";

export function BuildErrorsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const errors = useProjectStore((s) => s.compile.errors);
  const log = useProjectStore((s) => s.compile.log);
  const status = useProjectStore((s) => s.compile.status);
  const durationMs = useProjectStore((s) => s.compile.durationMs);

  const failed = status === "error";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[92vw] max-w-[860px] flex-col gap-0 p-0 sm:max-w-[860px]">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{failed ? "Build failed" : "Build log"}</DialogTitle>
          <DialogDescription>
            {errors.length} error{errors.length === 1 ? "" : "s"} - built in {durationMs} ms
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="errors" className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList className="mx-5 mt-3 w-fit">
            <TabsTrigger value="errors">Errors ({errors.length})</TabsTrigger>
            <TabsTrigger value="log">Raw log</TabsTrigger>
          </TabsList>

          <TabsContent
            value="errors"
            className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          >
            {errors.length === 0 ? (
              <TypographyMuted className="text-xs">
                No specific errors were parsed - see the Raw log tab.
              </TypographyMuted>
            ) : (
              <ul className="space-y-3">
                {errors.map((e, i) => (
                  <li key={i} className="space-y-1">
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                      {e.message}
                    </pre>
                    {e.file !== null || e.line !== null ? (
                      <TypographyMuted className="font-mono text-xs">
                        {e.file !== null ? e.file : ""}
                        {e.line !== null ? `:${e.line}` : ""}
                      </TypographyMuted>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent
            value="log"
            className="flex min-h-0 flex-1 flex-col gap-2 px-5 py-4"
          >
            {log.length === 0 ? (
              <TypographyMuted className="text-xs">No log output.</TypographyMuted>
            ) : (
              <>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void copyText(log).then((ok) => {
                        if (ok) toast.success("Build log copied");
                      });
                    }}
                  >
                    <IconCopy className="size-3.5" />
                    Copy
                  </Button>
                </div>
                <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-card p-3 font-mono text-xs text-muted-foreground">
                  {log}
                </pre>
              </>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="border-t border-border px-5 py-3">
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
