// block-actions.tsx -- the block's structural actions (move / insert / AI cleanup /
// pick up / delete), defined once and rendered into both the toolbar's more-menu
// and the right-click context menu so the two never drift apart.

import { Fragment, type ComponentType, type ReactNode } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconMessagePlus,
  IconSquareRoundedPlus,
  IconTextPlus,
  IconTrash,
  IconWand,
} from "@tabler/icons-react";
import { useProjectStore } from "@/stores/project-store";
import { dispatchAgentIntent } from "@/lib/ai/agent-controller";
import { findBridgeSuccessor } from "@/lib/ai/agent-context";
import {
  CLEAN_DIRECTIVE,
  PICK_UP_DIRECTIVE,
  STRUCTURE_DIRECTIVE,
} from "@/lib/ai/agent-prompts";
import type { DraftContextRef } from "@/lib/ai/agent-types";
import { nextSegmentKind } from "@/lib/blocks/dialogue";
import type { Block as BlockT, DialogueSegment } from "@/lib/types";

export type BlockAction = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

const blockRefs = (
  chapterId: string,
  blockIds: string[],
): DraftContextRef[] =>
  blockIds.map((blockId) => ({ kind: "block", chapterId, blockId }));

/** The structural actions, grouped so the renderer can place a separator between
 *  groups. Shared by the toolbar more-menu and the context menu so a single hook
 *  call keeps both menus in sync. */
export function useBlockActions(block: BlockT): BlockAction[][] {
  const moveBlock = useProjectStore((s) => s.moveBlock);
  const deleteBlock = useProjectStore((s) => s.deleteBlock);
  const insertAfter = useProjectStore((s) => s.insertAfter);
  const updateBlock = useProjectStore((s) => s.updateBlock);
  const structureBlock = useProjectStore((s) => s.structureBlock);
  const select = useProjectStore((s) => s.select);
  const beginEdit = useProjectStore((s) => s.beginEdit);

  const selectedBlockIds = (): string[] => {
    const state = useProjectStore.getState();
    return state.selectedIds.includes(block.id)
      ? state.selectedIds
      : [block.id];
  };

  const insertAbove = () => {
    // Click-time read: subscribing to s.blocks here would re-render every Block
    // on every keystroke (the array's identity changes per edit), defeating the
    // Block memo for the whole chapter.
    const blocks = useProjectStore.getState().blocks;
    const idx = blocks.findIndex((b) => b.id === block.id);
    insertAfter(idx > 0 ? blocks[idx - 1].id : null);
  };

  const onAddToChat = () => {
    const chapterId = useProjectStore.getState().activeChapterId;
    if (chapterId === null) return;
    void dispatchAgentIntent({
      kind: "add-context",
      refs: blockRefs(chapterId, selectedBlockIds()),
    });
  };

  const onClean = () => {
    const chapterId = useProjectStore.getState().activeChapterId;
    if (chapterId === null || !block.text.trim()) return;
    const blockIds = selectedBlockIds();
    void dispatchAgentIntent({
      kind: "run",
      mode: "edit",
      text: CLEAN_DIRECTIVE,
      refs: blockRefs(chapterId, blockIds),
      task: {
        kind: "selected-block-edit",
        chapterId,
        blockIds,
        operation: "clean",
      },
    });
  };

  // Continuing from a non-prose block would ground the run off-manuscript, so
  // the handoff only offers itself on prose.
  const prose = block.type === "narration" || block.type === "dialogue";

  // Worth offering only when the text would actually break into more than one
  // block: a blank line (multiple paragraphs) or an embedded quote (dialogue).
  const structurable =
    (block.type === "narration" || block.type === "latex") &&
    (/\n[ \t]*\n/.test(block.text) || block.text.includes('"'));

  const onStructureAi = () => {
    if (!structurable) return;
    const chapterId = useProjectStore.getState().activeChapterId;
    if (chapterId === null) return;
    const blockIds = selectedBlockIds();
    void dispatchAgentIntent({
      kind: "run",
      mode: "edit",
      text: STRUCTURE_DIRECTIVE,
      refs: blockRefs(chapterId, blockIds),
      task: {
        kind: "selected-block-edit",
        chapterId,
        blockIds,
        operation: "structure",
      },
    });
  };

  const onPickUp = () => {
    const state = useProjectStore.getState();
    const chapterId = state.activeChapterId;
    if (
      chapterId === null ||
      !state.blocks.some((candidate) => candidate.id === block.id)
    ) {
      return;
    }
    void dispatchAgentIntent({
      kind: "run",
      mode: "writing",
      text: PICK_UP_DIRECTIVE,
      refs: blockRefs(chapterId, [block.id]),
      task: {
        kind: "bridge",
        chapterId,
        anchorBlockId: block.id,
        successorBlockId: findBridgeSuccessor(state.blocks, block.id),
      },
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
        icon: IconMessagePlus,
        label: "Add to Chat",
        onSelect: onAddToChat,
      },
      {
        icon: IconWand,
        label: "Clean up with AI",
        onSelect: onClean,
        disabled: !block.text.trim(),
      },
      ...(prose
        ? [
            {
              icon: IconWand,
              label: "Pick up from here",
              onSelect: onPickUp,
            },
          ]
        : []),
      ...(structurable
        ? [{ icon: IconTextPlus, label: "Structure into blocks", onSelect: () => structureBlock(block.id) }]
        : []),
      ...(structurable
        ? [{ icon: IconWand, label: "Structure with AI", onSelect: onStructureAi }]
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
