// editor.tsx - the center column: the chapter as an editable block stream.

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  GitMerge as IconGitMerge,
  Plus as IconPlus,
  Sparkles as IconSparkles,
  PenLine as IconWriting,
} from "lucide-react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { Block } from "@/components/app/block";
import { FindBar } from "@/components/app/find-bar";
import { ManuscriptReviewSurface } from "@/components/app/manuscript-review/manuscript-review-surface";
import { SelectionToolbar } from "@/components/app/selection-toolbar";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  TypographyForeground,
  TypographyLarge,
  TypographyMuted,
  TypographyMutedSpan,
  TypographyInlineCode,
} from "@/components/ui/typography";
import {
  selectionTargetIds,
  useProjectStore,
} from "@/stores/project-store";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";
import { useSyncStore } from "@/stores/sync-store";
import { useViewStore } from "@/stores/view-store";
import { dispatchAgentIntent } from "@/lib/ai/agent-controller";
import { buildContinuationIntent } from "@/lib/ai/agent-continuation";
import { getAgentChangesSnapshot, useAgentChanges } from "@/hooks/use-agent-changes";
import { editorAuthoringIsBlocked, useEditorInteractions } from "@/hooks/use-editor-interactions";
import { countWords } from "@/lib/latex";
import type { Block as BlockT, BlockType } from "@/lib/types";

// Per-block word counts cached by object identity: updateBlockText keeps every
// untouched block's identity, so a keystroke recounts only the edited block
// instead of re-splitting the whole chapter's text.
const blockWords = new WeakMap<BlockT, number>();
function liveWordCount(blocks: BlockT[]): number {
  let total = 0;
  for (const b of blocks) {
    let n = blockWords.get(b);
    if (n === undefined) {
      n = countWords([b]);
      blockWords.set(b, n);
    }
    total += n;
  }
  return total;
}

function AddBlockRow() {
  const insertAfter = useProjectStore((s) => s.insertAfter);
  const selectedId = useProjectStore((s) => s.selectedId);
  const busy = useAgentChanges().runStatus !== "idle";

  const add = (type: BlockType) => {
    if (!editorAuthoringIsBlocked()) insertAfter(selectedId, { type });
  };
  const suggest = () => {
    if (editorAuthoringIsBlocked()) return;
    const state = useProjectStore.getState();
    if (getAgentChangesSnapshot().runStatus !== "idle") return;
    const chapterId = state.activeChapterId;
    if (chapterId === null) return;
    void dispatchAgentIntent(buildContinuationIntent(
      chapterId, state.blocks, selectionTargetIds(state.selectedIds, state.selectedId),
    ));
  };

  return (
    <div className="mt-2 flex flex-wrap gap-1.5 py-4">
      <Button variant="outline" size="sm" onClick={() => add("narration")}>
        <IconPlus /> Narration
      </Button>
      <Button variant="outline" size="sm" onClick={() => add("dialogue")}>
        <IconPlus /> Dialogue
      </Button>
      <Button variant="outline" size="sm" onClick={() => add("scratchpad")}>
        <IconPlus /> Scratchpad
      </Button>
      <Button variant="outline" size="sm" onClick={() => {
        if (!editorAuthoringIsBlocked()) insertAfter(selectedId, { type: "chapter", level: "break", text: "* * *" });
      }}>
        <IconPlus /> Scene break
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={suggest}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? <Spinner className="motion-reduce:animate-none" /> : <IconSparkles className="size-3.5" />}
        Suggest from context
      </Button>
    </div>
  );
}

export function Editor() {
  const project = useProjectStore((s) => s.project);
  const activeId = useProjectStore((s) => s.activeChapterId);
  const blocks = useProjectStore((s) => s.blocks);
  // Shallow-stable id list: text edits change the blocks array identity every
  // keystroke, and a fresh items array makes dnd-kit's SortableContext push a
  // new context value to every block's useSortable - re-rendering the whole
  // chapter. useShallow keeps the previous array while the ids are unchanged.
  const blockIds = useProjectStore(useShallow((s) => s.blocks.map((b) => b.id)));
  const chapterDirty = useProjectStore((s) => s.chapterDirty);
  const remoteDivergence = useProjectStore((s) => s.remoteDivergence);
  const select = useProjectStore((state) => state.select);
  const activateSearchSurface = useSearchSurfaceStore((state) => state.activate);
  const { activeReview, authoringEnabled, sensors, onDragEnd, dictation, pendingDeleteId, setPendingDeleteId, confirmDelete } = useEditorInteractions();

  const conflictedFiles = useSyncStore((s) => s.conflictedFiles);

  const chapter = project?.chapters.find((c) => c.id === activeId);

  // Live word count: chapter.wordCount only refreshes on save, which reads as
  // a stuck number to a writer chasing a daily quota.
  const liveWords = useMemo(() => liveWordCount(blocks), [blocks]);


  if (!chapter) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <IconWriting className="size-8 text-faint" />
        <TypographyMuted>Select a chapter to begin.</TypographyMuted>
      </div>
    );
  }

  if (conflictedFiles.includes(chapter.file)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-8 text-center">
        <IconGitMerge className="size-8 text-destructive" />
        <TypographyLarge>This chapter has a merge conflict</TypographyLarge>
        <TypographyMuted className="max-w-sm text-sm">
          Resolve the conflict in <TypographyInlineCode>{chapter.file}</TypographyInlineCode> with git, then
          sync again. Editing is disabled here until it's resolved to avoid corrupting the file.
        </TypographyMuted>
      </div>
    );
  }

  return (
    <div
      className="relative h-full min-h-0"
      data-search-surface="editor"
      onPointerDownCapture={() => activateSearchSurface("editor")}
      onFocusCapture={() => activateSearchSurface("editor")}
    >
      {activeReview === null ? <FindBar /> : null}
      {activeReview === null ? (
        <AlertDialog
          open={pendingDeleteId !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteId(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this block?</AlertDialogTitle>
              <AlertDialogDescription>
                This block contains content. Confirm that you want to delete it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={confirmDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      <ScrollArea
        className="h-full bg-background"
        // A press on empty editor surface (gutters, padding, the chapter header)
        // clears the selection so the active block leaves edit mode. Blocks handle
        // their own selection; buttons (the add-block row) and the scrollbar keep
        // the selection so they still act on the selected block. (The find widget is
        // a sibling of this ScrollArea, so its presses never reach this handler.)
        onMouseDown={
          authoringEnabled
            ? (e) => {
                if (editorAuthoringIsBlocked()) return;
                const t = e.target as Element;
                if (
                  t.closest("[data-block-id]") ||
                  t.closest("button") ||
                  t.closest('[data-slot="scroll-area-scrollbar"]')
                )
                  return;
                select(null);
              }
            : undefined
        }
      >
        <div className="mx-auto flex w-full max-w-[720px] flex-col px-7 pb-48 pt-9">
          {remoteDivergence === null ? null : (
            <Alert className="mb-4">
              <AlertTitle>{remoteDivergence.reason === "chapter-deleted" ? "Deleted chapter draft preserved" : remoteDivergence.reason === "remote-pull" ? "Backup changed this project" : "Project files need resolution"}</AlertTitle>
              <AlertDescription>
                Your draft is preserved here. Saving is paused to protect the files on disk.
                Copy any draft you want to keep before reopening the project.
              </AlertDescription>
              <div className="mt-2">
                <Button variant="outline" size="sm" onClick={() => {
                  const current = useProjectStore.getState().project;
                  if (current === null) return;
                  useViewStore.getState().requestGuarded(() =>
                    useProjectStore.getState().loadProjectAt(current.root),
                  );
                }}>Reopen project</Button>
              </div>
            </Alert>
          )}
          <header className="mb-5 flex items-baseline gap-3 border-b border-border pb-3.5">
            <TypographyMutedSpan className="text-lg">
              Chapter {chapter.label}
            </TypographyMutedSpan>
            <TypographyForeground className="text-2xl font-medium">
              {chapter.title}
            </TypographyForeground>
            <TypographyMutedSpan className="ml-auto text-xs tabular-nums">
              {blocks.length} blocks - {liveWords.toLocaleString()} words -{" "}
              {chapterDirty ? "unsaved" : "saved"}
            </TypographyMutedSpan>
          </header>

          {activeReview === null ? (
            <>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis]}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={blockIds}
                  strategy={verticalListSortingStrategy}
                >
                  {blocks.map((b) => (
                    <Block key={b.id} block={b} dictation={dictation} />
                  ))}
                </SortableContext>
              </DndContext>

              <AddBlockRow />
              <SelectionToolbar />
              <div aria-hidden data-editor-end />
            </>
          ) : (
            <ManuscriptReviewSurface proposal={activeReview} />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
