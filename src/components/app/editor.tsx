// editor.tsx — the center column: the chapter as an editable block stream.

import {
  IconSparkles,
  IconWriting,
} from "@tabler/icons-react";
import { Block } from "@/components/app/block";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { useDictation } from "@/lib/use-dictation";
import type { BlockType } from "@/lib/types";
import { cn } from "@/lib/utils";

function CursorRow() {
  const insertAfter = useProjectStore((s) => s.insertAfter);
  const selectedId = useProjectStore((s) => s.selectedId);
  const triggerSuggest = useViewStore((s) => s.triggerSuggest);

  const add = (type: BlockType) => insertAfter(selectedId, { type });

  return (
    <div className="mt-2 flex flex-col gap-2.5 py-4 pl-7">
      <div className="flex items-center gap-2.5">
        <span className="inline-block h-5 w-0.5 animate-blink rounded-full bg-accent-ink" />
        <span className="font-sans text-[10.5px] uppercase tracking-[0.08em] text-faint">
          Cursor — next block
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 font-sans">
        <Button variant="outline" size="sm" className="rounded-full border-dashed" onClick={() => add("narration")}>
          + Narration
        </Button>
        <Button variant="outline" size="sm" className="rounded-full border-dashed" onClick={() => add("dialogue")}>
          + Dialogue
        </Button>
        <Button variant="outline" size="sm" className="rounded-full border-dashed" onClick={() => add("scratchpad")}>
          + Scratchpad
        </Button>
        <Button
          size="sm"
          className="rounded-full border border-ai-edge bg-ai-tint text-ai-ink hover:bg-ai-tint hover:brightness-95"
          onClick={triggerSuggest}
        >
          <IconSparkles className="size-3.5" />
          Suggest from context
        </Button>
      </div>
    </div>
  );
}

export function Editor() {
  const project = useProjectStore((s) => s.project);
  const activeId = useProjectStore((s) => s.activeChapterId);
  const blocks = useProjectStore((s) => s.blocks);
  const chapterDirty = useProjectStore((s) => s.chapterDirty);

  // One recognizer for the whole editor; dictation lands in the selected block.
  const dictation = useDictation((text) => {
    const st = useProjectStore.getState();
    const id = st.selectedId;
    if (!id) return;
    const b = st.blocks.find((x) => x.id === id);
    if (!b) return;
    st.updateBlockText(id, (b.text ? `${b.text} ` : "") + text);
  });

  const chapter = project?.chapters.find((c) => c.id === activeId);

  if (!chapter) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background font-sans text-mid">
        <IconWriting className="size-8 text-faint" />
        <p className="text-sm">Select a chapter to begin.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full bg-background">
      <div className="mx-auto flex w-full max-w-[720px] flex-col px-7 pb-48 pt-9">
        <header className="mb-5 flex items-baseline gap-3 border-b border-line-soft pb-3.5">
          <span className="font-serif text-lg italic text-mid">Chapter {chapter.label}</span>
          <span className="font-heading text-2xl font-medium tracking-tight text-foreground">
            {chapter.title}
          </span>
          <span className={cn("ml-auto font-sans text-[11.5px] tabular-nums text-faint")}>
            {blocks.length} blocks · {chapter.wordCount.toLocaleString()} words ·{" "}
            {chapterDirty ? "unsaved" : "saved"}
          </span>
        </header>

        {blocks.map((b) => (
          <Block key={b.id} block={b} dictation={dictation} />
        ))}

        <CursorRow />
      </div>
    </ScrollArea>
  );
}
