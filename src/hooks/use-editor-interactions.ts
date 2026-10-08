import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useKeybindingWithOptions, type UseKeybindingOptions } from "@/hooks/use-keybinding";
import { useDictation } from "@/hooks/use-dictation";
import { blockHasContent } from "@/components/app/block/block-text";
import { dispatchAgentIntent } from "@/lib/ai/agent-controller";
import type { ManuscriptPendingProposal, PendingProposal } from "@/lib/ai/agent-types";
import { toggleInlineWrap, type InlineMarker } from "@/lib/blocks/format";
import { isInAuxSurface, isInteractiveTarget, scrollBlockIntoView } from "@/lib/dom";
import { KEYBINDING_IDS } from "@/lib/keybindings";
import { PROSE_BODY_SELECTOR } from "@/lib/prose-body";
import { useAgentConsoleStore } from "@/stores/agent-console-store";
import { selectionTargetIds, useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

function matchingManuscriptReview(
  pendingProposal: PendingProposal | null,
  reviewProposalId: string | null,
  projectRoot: string | null,
  activeChapterId: string | null,
): ManuscriptPendingProposal | null {
  return pendingProposal !== null &&
    pendingProposal.kind === "manuscript" &&
    reviewProposalId === pendingProposal.id &&
    projectRoot === pendingProposal.projectRoot &&
    activeChapterId === pendingProposal.chapterId
    ? pendingProposal
    : null;
}

export function editorAuthoringIsBlocked(): boolean {
  const view = useViewStore.getState();
  if (view.outlineOpen && !view.focus) return true;
  const pendingProposal = useAgentConsoleStore.getState().pendingProposal;
  const reviewProposalId = useViewStore.getState().manuscriptReviewProposalId;
  const projectState = useProjectStore.getState();
  const projectRoot =
    projectState.project === null ? null : projectState.project.root;
  return (
    matchingManuscriptReview(
      pendingProposal,
      reviewProposalId,
      projectRoot,
      projectState.activeChapterId,
    ) !== null
  );
}

// After a nav-key move, bring the newly-selected block into view.
function scrollSelectedIntoView(): void {
  const id = useProjectStore.getState().selectedId;
  if (!id) return;
  scrollBlockIntoView(id);
}

interface EditorInteractions {
  activeReview: ManuscriptPendingProposal | null;
  authoringEnabled: boolean;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  dictation: ReturnType<typeof useDictation>;
  pendingDeleteId: string | null;
  setPendingDeleteId: Dispatch<SetStateAction<string | null>>;
  confirmDelete: () => void;
}

export function useEditorInteractions(): EditorInteractions {
  const project = useProjectStore((state) => state.project);
  const activeId = useProjectStore((state) => state.activeChapterId);
  const selectedId = useProjectStore((s) => s.selectedId);
  const editing = useProjectStore((s) => s.editing);
  const reorderBlock = useProjectStore((s) => s.reorderBlock);
  const pendingProposal = useAgentConsoleStore((s) => s.pendingProposal);
  const manuscriptReviewProposalId = useViewStore(
    (s) => s.manuscriptReviewProposalId,
  );
  const activeReview = matchingManuscriptReview(
    pendingProposal,
    manuscriptReviewProposalId,
    project === null ? null : project.root,
    activeId,
  );
  const outlineOpen = useViewStore((state) => state.outlineOpen);
  const focus = useViewStore((state) => state.focus);
  const authoringEnabled = activeReview === null && (!outlineOpen || focus);
  const authoringOptions: UseKeybindingOptions = useMemo(
    () => ({
      enabled: authoringEnabled,
      ignoreEventWhen: () => false,
    }),
    [authoringEnabled],
  );
  // Editor history and formatting defer to native behavior while the AI console
  // or a dialog holds focus, so those inputs keep their own history.
  const historyOptions: UseKeybindingOptions = useMemo(
    () => ({
      enabled: authoringEnabled,
      ignoreEventWhen: (event) =>
        isInAuxSurface(event.target as Element | null),
    }),
    [authoringEnabled],
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Drag-to-reorder (grip handle). PointerSensor's 6px activation keeps a plain
  // click on the grip a selection rather than a drag; KeyboardSensor makes the
  // handle operable with space + arrows.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent): void => {
    if (editorAuthoringIsBlocked()) return;
    const { active, over } = e;
    if (over && active.id !== over.id) {
      reorderBlock(String(active.id), String(over.id));
    }
  };

  // One recognizer for the whole editor; dictation lands in the selected block.
  const dictation = useDictation((text) => {
    if (editorAuthoringIsBlocked()) return;
    const st = useProjectStore.getState();
    const id = st.selectedId;
    if (!id) return;
    const b = st.blocks.find((x) => x.id === id);
    if (!b) return;
    st.updateBlockText(id, (b.text ? `${b.text} ` : "") + text);
  });
  useEffect(() => {
    if (!authoringEnabled && dictation.listening) dictation.toggle();
  }, [authoringEnabled, dictation.listening, dictation.toggle]);

  // Document + history shortcuts live with the editing surface they act on.
  useKeybindingWithOptions(
    KEYBINDING_IDS.SAVE_CHAPTER,
    () => {
      if (editorAuthoringIsBlocked()) return;
      void useProjectStore.getState().compileNow();
    },
    authoringOptions,
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.UNDO,
    () => {
      if (editorAuthoringIsBlocked()) return;
      useProjectStore.getState().undo();
    },
    historyOptions,
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.REDO,
    () => {
      if (editorAuthoringIsBlocked()) return;
      useProjectStore.getState().redo();
    },
    historyOptions,
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.REDO_ALT,
    () => {
      if (editorAuthoringIsBlocked()) return;
      useProjectStore.getState().redo();
    },
    historyOptions,
  );

  // Carve/split: Cmd+Shift+Enter. With a selection it isolates the slice as its
  // own same-type block (like the toolbar's Split); a bare caret splits in two.
  useKeybindingWithOptions(
    KEYBINDING_IDS.SPLIT_BLOCK,
    () => {
      if (editorAuthoringIsBlocked()) return;
      const el = document.activeElement;
      if (
        !(el instanceof HTMLTextAreaElement) ||
        !el.matches(PROSE_BODY_SELECTOR)
      )
        return;
      const host = el.closest("[data-block-id]");
      const blockId =
        host instanceof HTMLElement ? host.dataset.blockId : undefined;
      if (!blockId) return;
      const store = useProjectStore.getState();
      const { selectionStart, selectionEnd } = el;
      if (selectionStart !== selectionEnd) {
        const block = store.blocks.find((b) => b.id === blockId);
        if (block)
          store.convertSelection(
            blockId,
            selectionStart,
            selectionEnd,
            block.type,
          );
      } else {
        store.splitBlock(blockId, selectionStart);
      }
    },
    authoringOptions,
  );

  useKeybindingWithOptions(
    KEYBINDING_IDS.ADD_SELECTION_TO_AI,
    () => {
      if (editorAuthoringIsBlocked()) return;
      const state = useProjectStore.getState();
      const chapterId = state.activeChapterId;
      const blockIds = selectionTargetIds(state.selectedIds, state.selectedId);
      if (chapterId === null || blockIds.length === 0) return;
      useViewStore.getState().requestAiComposerFocus();
      void dispatchAgentIntent({
        kind: "add-context",
        refs: blockIds.map((blockId) => ({
          kind: "block" as const,
          chapterId,
          blockId,
        })),
      });
    },
    historyOptions,
  );

  // Inline emphasis: Cmd/Ctrl+B bold, Cmd/Ctrl+I italic. Toggle the marker around
  // the focused prose-body textarea's selection, mirroring SPLIT_BLOCK's read of
  // document.activeElement. The textarea is controlled, so the new selection is
  // restored on the next frame, after React commits the new value.
  const applyFormat = (marker: InlineMarker) => {
    if (editorAuthoringIsBlocked()) return;
    const el = document.activeElement;
    if (
      !(el instanceof HTMLTextAreaElement) ||
      !el.matches(PROSE_BODY_SELECTOR)
    )
      return;
    const host = el.closest("[data-block-id]");
    const blockId =
      host instanceof HTMLElement ? host.dataset.blockId : undefined;
    if (!blockId) return;
    const res = toggleInlineWrap(
      { text: el.value, start: el.selectionStart, end: el.selectionEnd },
      marker,
    );
    useProjectStore.getState().formatBlockText(blockId, res.text);
    requestAnimationFrame(() => {
      if (!el.isConnected || editorAuthoringIsBlocked()) return;
      el.focus();
      el.setSelectionRange(res.start, res.end);
    });
  };
  useKeybindingWithOptions(
    KEYBINDING_IDS.FORMAT_BOLD,
    () => applyFormat("**"),
    historyOptions,
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.FORMAT_ITALIC,
    () => applyFormat("_"),
    historyOptions,
  );

  // Block nav/edit modal keys. `Up`/`Down`/`i` are non-chord, so they're inert while
  // a textarea is focused (edit mode); the `!editing` gate is belt-and-suspenders
  // and powers on-screen hints. All four bow out of the AI panel / dialogs.
  const navOptions: UseKeybindingOptions = useMemo(
    () => ({
      enabled: authoringEnabled && selectedId != null && !editing,
      ignoreEventWhen: (e) => isInAuxSurface(e.target as Element | null),
    }),
    [authoringEnabled, selectedId, editing],
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.NAV_PREV_BLOCK,
    () => {
      if (editorAuthoringIsBlocked()) return;
      useProjectStore.getState().moveSelection(-1);
      scrollSelectedIntoView();
    },
    navOptions,
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.NAV_NEXT_BLOCK,
    () => {
      if (editorAuthoringIsBlocked()) return;
      useProjectStore.getState().moveSelection(1);
      scrollSelectedIntoView();
    },
    navOptions,
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.EDIT_BLOCK,
    () => {
      if (editorAuthoringIsBlocked()) return;
      useProjectStore.getState().beginEdit("start");
    },
    navOptions,
  );
  // Nav-mode Enter resumes typing where the block left off (appending is the
  // common case), complementing `i`'s caret-at-start. Unlike `i`/arrows, Enter
  // is also the native activation key, so it must yield to a focused button or
  // menu item instead of hijacking its press.
  const enterNavOptions: UseKeybindingOptions = useMemo(
    () => ({
      enabled: authoringEnabled && selectedId != null && !editing,
      ignoreEventWhen: (e) =>
        isInAuxSurface(e.target as Element | null) || isInteractiveTarget(e.target),
    }),
    [authoringEnabled, selectedId, editing],
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.EDIT_BLOCK_ENTER,
    () => {
      if (editorAuthoringIsBlocked()) return;
      useProjectStore.getState().beginEdit("end");
    },
    enterNavOptions,
  );

  const deleteOptions: UseKeybindingOptions = useMemo(
    () => ({
      enabled: authoringEnabled && selectedId != null && !editing,
      ignoreEventWhen: (e) =>
        isInAuxSurface(e.target as Element | null) || isInteractiveTarget(e.target),
    }),
    [authoringEnabled, selectedId, editing],
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.DELETE_BLOCK,
    () => {
      if (editorAuthoringIsBlocked()) return;
      const st = useProjectStore.getState();
      if (st.selectedId === null) return;
      const block = st.blocks.find((candidate) => candidate.id === st.selectedId);
      if (!block) return;
      if (blockHasContent(block)) {
        setPendingDeleteId(block.id);
        return;
      }
      st.deleteBlock(block.id);
    },
    deleteOptions,
  );

  // Esc exits edit mode (back to nav), or deselects when already in nav mode. It
  // fires from inside the block textarea (firesWhileEditing) but bows out of the
  // AI panel / dialogs, which own their own Esc.
  const exitOptions: UseKeybindingOptions = useMemo(
    () => ({
      enabled: authoringEnabled && selectedId != null,
      ignoreEventWhen: (e) => isInAuxSurface(e.target as Element | null),
    }),
    [authoringEnabled, selectedId],
  );
  useKeybindingWithOptions(
    KEYBINDING_IDS.EXIT_BLOCK,
    () => {
      if (editorAuthoringIsBlocked()) return;
      const st = useProjectStore.getState();
      if (st.editing) st.stopEdit();
      else st.deselect();
    },
    exitOptions,
  );

  const confirmDelete = (): void => {
    if (editorAuthoringIsBlocked()) return;
    if (pendingDeleteId === null) {
      throw new Error("Cannot confirm block deletion without a pending block");
    }
    useProjectStore.getState().deleteBlock(pendingDeleteId);
    setPendingDeleteId(null);
  };
  return { activeReview, authoringEnabled, sensors, onDragEnd, dictation, pendingDeleteId, setPendingDeleteId, confirmDelete };
}
