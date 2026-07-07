// block-actions.tsx -- the block's structural actions (move / insert / AI cleanup /
// pick up / delete), defined once and rendered into both the toolbar's more-menu
// and the right-click context menu so the two never drift apart.

import { Fragment, useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import {
  IconArrowDown,
  IconArrowUp,
  IconSquareRoundedPlus,
  IconTextPlus,
  IconTrash,
  IconWand,
} from "@tabler/icons-react";
import { useProjectStore } from "@/stores/project-store";
import { dispatchAiIntent } from "@/stores/ai-intent-store";
import { buildAiContext } from "@/lib/ai/context";
import { cleanTranscript } from "@/lib/ai/operations";
import { describeAiError, withAiRetry } from "@/lib/ai/errors";
import { PICK_UP_AND_GO_DIRECTIVE, pickUpCursorSuffix } from "@/lib/ai/prompts";
import { nextSegmentKind } from "@/lib/blocks/dialogue";
import type { Block as BlockT, DialogueSegment } from "@/lib/types";

export type BlockAction = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

/** The structural actions, grouped so the renderer can place a separator between
 *  groups. Shared by the toolbar more-menu and the context menu; the `cleaning`
 *  state lives here so a single hook call keeps both menus in sync. */
export function useBlockActions(block: BlockT): BlockAction[][] {
  const moveBlock = useProjectStore((s) => s.moveBlock);
  const deleteBlock = useProjectStore((s) => s.deleteBlock);
  const insertAfter = useProjectStore((s) => s.insertAfter);
  const updateBlockText = useProjectStore((s) => s.updateBlockText);
  const setSelection = useProjectStore((s) => s.setSelection);
  const updateBlock = useProjectStore((s) => s.updateBlock);
  const structureBlock = useProjectStore((s) => s.structureBlock);
  const select = useProjectStore((s) => s.select);
  const beginEdit = useProjectStore((s) => s.beginEdit);
  const [cleaning, setCleaning] = useState(false);

  const insertAbove = () => {
    // Click-time read: subscribing to s.blocks here would re-render every Block
    // on every keystroke (the array's identity changes per edit), defeating the
    // Block memo for the whole chapter.
    const blocks = useProjectStore.getState().blocks;
    const idx = blocks.findIndex((b) => b.id === block.id);
    insertAfter(idx > 0 ? blocks[idx - 1].id : null);
  };

  const onClean = async () => {
    if (!block.text.trim()) return;
    setCleaning(true);
    const t = toast.loading("Cleaning up with AI");
    try {
      const cleaned = await withAiRetry(() => cleanTranscript(block.text, buildAiContext(block.id)));
      updateBlockText(block.id, cleaned.trim());
      toast.success("Tidied up", { id: t });
    } catch (e) {
      toast.error("Couldn't reach the model", { id: t, description: describeAiError(e) });
    } finally {
      setCleaning(false);
    }
  };

  // Continuing from a lore/scratchpad/latex block would ground the muse run
  // off-manuscript, so the handoff only offers itself on prose.
  const prose = block.type === "narration" || block.type === "dialogue";

  // Worth offering only when the text would actually break into more than one
  // block: a blank line (multiple paragraphs) or an embedded quote (dialogue).
  const structurable =
    (block.type === "narration" || block.type === "latex") &&
    (/\n[ \t]*\n/.test(block.text) || block.text.includes('"'));

  const onPickUp = () => {
    // Select the block so the author lands oriented when the panel opens. The
    // cursor itself travels in the directive's suffix line - the agent's
    // read_chapter grounding does not carry the selection.
    setSelection([block.id]);
    dispatchAiIntent({
      tab: "muse",
      instruction: PICK_UP_AND_GO_DIRECTIVE + pickUpCursorSuffix(block.id),
      autoRun: true,
    });
  };

  return [
    [
      { icon: IconArrowUp, label: "Move up", onSelect: () => moveBlock(block.id, -1) },
      { icon: IconArrowDown, label: "Move down", onSelect: () => moveBlock(block.id, 1) },
    ],
    [
      { icon: IconSquareRoundedPlus, label: "Insert block above", onSelect: insertAbove },
      { icon: IconSquareRoundedPlus, label: "Insert block below", onSelect: () => insertAfter(block.id) },
      // Strict alternation means the next segment's kind is always forced, so
      // the label and appended kind both come from nextSegmentKind - giving a
      // dialogue its first beat (or a beat its reply) is an explicit action.
      ...(block.type === "dialogue"
        ? [
            {
              icon: IconTextPlus,
              label: nextSegmentKind(block) === "beat" ? "Add action beat" : "Add spoken line",
              onSelect: () => {
                const seg: DialogueSegment = { kind: nextSegmentKind(block), text: "" };
                updateBlock(block.id, { tail: [...(block.tail ?? []), seg] });
                select(block.id);
                beginEdit();
              },
            },
          ]
        : []),
      // Remove the trailing segment only when it is empty (nothing to lose), so a
      // mis-added beat/line has an explicit way back out (parity with the old
      // "Remove action beat").
      ...(block.type === "dialogue" &&
      block.tail &&
      block.tail.length > 0 &&
      block.tail[block.tail.length - 1].text.trim() === ""
        ? [
            {
              icon: IconTextPlus,
              label: "Remove last segment",
              onSelect: () => {
                const next = block.tail!.slice(0, -1);
                updateBlock(block.id, { tail: next.length > 0 ? next : undefined });
              },
            },
          ]
        : []),
    ],
    [
      {
        icon: IconWand,
        label: "Clean up with AI",
        onSelect: () => void onClean(),
        disabled: cleaning || !block.text.trim(),
      },
      {
        icon: IconWand,
        label: "Pick up from here",
        onSelect: onPickUp,
        disabled: !prose,
      },
      ...(structurable
        ? [{ icon: IconTextPlus, label: "Structure into blocks", onSelect: () => structureBlock(block.id) }]
        : []),
    ],
    [{ icon: IconTrash, label: "Delete block", onSelect: () => deleteBlock(block.id), destructive: true }],
  ];
}

/** A menu primitive (DropdownMenuItem / ContextMenuItem) - both shadcn items share
 *  this prop shape, so one renderer drives either menu. */
type MenuItemComponent = ComponentType<{
  disabled?: boolean;
  variant?: "default" | "destructive";
  onSelect?: (event: Event) => void;
  children?: ReactNode;
}>;

/** Render grouped block actions into a menu, with a separator between each group. */
export function BlockActionItems({
  groups,
  Item,
  Separator,
}: {
  groups: BlockAction[][];
  Item: MenuItemComponent;
  Separator: ComponentType;
}) {
  return groups.map((group, gi) => (
    <Fragment key={gi}>
      {gi > 0 ? <Separator /> : null}
      {group.map((a) => (
        <Item
          key={a.label}
          disabled={a.disabled}
          variant={a.destructive ? "destructive" : "default"}
          onSelect={a.onSelect}
        >
          <a.icon /> {a.label}
        </Item>
      ))}
    </Fragment>
  ));
}
