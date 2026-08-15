import type { ReactNode } from "react";
import { Check as IconCheck, Pencil as IconEdit, X as IconX } from "lucide-react";
import { AgentDiffPreview } from "@/components/app/agent-console/diff-preview";
import { AutoGrowTextarea } from "@/components/app/auto-textarea";
import { BlockBody } from "@/components/app/block/block-body";
import { findSpeaker } from "@/components/app/block/block-text";
import {
  DIALOGUE_BEAT,
  DIALOGUE_INDENT,
  DIALOGUE_QUOTE,
  PROSE,
} from "@/components/app/block/constants";
import { ColorDot } from "@/components/app/color-dot";
import { renderInline } from "@/components/app/inline";
import { Button } from "@/components/ui/button";
import {
  TypographyEyebrow,
  TypographyMuted,
  TypographyP,
} from "@/components/ui/typography";
import type {
  ManuscriptPendingChange,
  SourceLocator,
} from "@/lib/ai/agent-types";
import type { ManuscriptReviewRow } from "@/lib/ai/manuscript-review-projection";
import type { Character, DialogueSegment } from "@/lib/types";
import { cn } from "@/lib/utils";

const COMPACT_PARAGRAPH = "[&:not(:first-child)]:mt-0";

export interface ManuscriptReviewChangeProps {
  row: ManuscriptReviewRow;
  characters: Character[];
  disabled: boolean;
  /** The in-progress edit for this row, or `null` when it is not being edited.
   *  The draft stays local until Save, so Discard is a real undo. */
  draft: string | null;
  onBeginEdit: (changeId: string, text: string) => void;
  onDraftChange: (value: string) => void;
  onSaveEdit: () => void;
  onDiscardEdit: () => void;
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled manuscript review row: ${JSON.stringify(value)}`);
}

function requiredText(value: string | null, changeId: string): string {
  if (value === null) {
    throw new Error(`Manuscript change ${changeId} requires proposal text.`);
  }
  return value;
}

function targetLocator(change: ManuscriptPendingChange): SourceLocator {
  const precondition = change.precondition;
  switch (precondition.kind) {
    case "target":
    case "move":
      return precondition.target;
    case "insert":
      throw new Error(`Manuscript change ${change.id} requires a target.`);
    default:
      return assertNever(precondition);
  }
}

function insertPosition(change: ManuscriptPendingChange): string {
  const precondition = change.precondition;
  if (precondition.kind !== "insert") {
    throw new Error(`Manuscript change ${change.id} requires an insert boundary.`);
  }
  if (precondition.anchor !== null) {
    return `After ${precondition.anchor.label}`;
  }
  if (precondition.expectedNext !== null) {
    return `Before ${precondition.expectedNext.label}`;
  }
  return "End of chapter";
}

function rowLabel(row: Exclude<ManuscriptReviewRow, { kind: "unchanged" }>): string {
  switch (row.kind) {
    case "rewrite":
      return "Rewrite";
    case "insert":
      return "Insert";
    case "remove":
      return "Remove";
    case "move-source":
      return "Move source";
    case "move-destination":
      return "Move destination";
    case "stale":
      return `Stale ${row.change.change.kind}`;
    default:
      return assertNever(row);
  }
}

function rowPosition(row: Exclude<ManuscriptReviewRow, { kind: "unchanged" }>): string {
  switch (row.kind) {
    case "rewrite":
    case "remove":
    case "move-source":
      return targetLocator(row.change).label;
    case "insert":
      return insertPosition(row.change);
    case "move-destination":
      return `Position ${row.destinationIndex + 1}`;
    case "stale":
      return `${row.sourceType} position ${row.frozenOrder + 1}`;
    default:
      return assertNever(row);
  }
}

function ChangeHeading({
  row,
}: {
  row: Exclude<ManuscriptReviewRow, { kind: "unchanged" }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <TypographyEyebrow>{rowLabel(row)}</TypographyEyebrow>
      <TypographyMuted>{rowPosition(row)}</TypographyMuted>
    </div>
  );
}

function ChangeReason({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col gap-1">
      <TypographyEyebrow>Reason</TypographyEyebrow>
      <TypographyMuted>{reason}</TypographyMuted>
    </div>
  );
}

function DecisionControls({
  changeId,
  disabled,
  acceptDisabled,
  onAccept,
  onReject,
}: {
  changeId: string;
  disabled: boolean;
  acceptDisabled: boolean;
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        disabled={disabled || acceptDisabled}
        onClick={() => onAccept(changeId)}
        size="sm"
      >
        <IconCheck data-icon="inline-start" />
        Accept
      </Button>
      <Button
        disabled={disabled}
        onClick={() => onReject(changeId)}
        size="sm"
        variant="outline"
      >
        <IconX data-icon="inline-start" />
        Reject
      </Button>
    </div>
  );
}

function EditControls({
  disabled,
  onSaveEdit,
  onDiscardEdit,
}: {
  disabled: boolean;
  onSaveEdit: () => void;
  onDiscardEdit: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button disabled={disabled} onClick={onSaveEdit} size="sm">
        <IconCheck data-icon="inline-start" />
        Save
      </Button>
      <Button
        disabled={disabled}
        onClick={onDiscardEdit}
        size="sm"
        variant="outline"
      >
        <IconX data-icon="inline-start" />
        Discard
      </Button>
    </div>
  );
}

/** The well that makes edit mode read as a field rather than as prose. It
 *  borrows the Input primitive's border and focus ring because the textarea
 *  inside it is chromeless. Callers supply the textarea (and any block-type
 *  decoration). */
function EditSurface({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <TypographyEyebrow>Editing</TypographyEyebrow>
      <div className="rounded-md border border-input bg-background px-3 py-2 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        {children}
      </div>
    </div>
  );
}

function ProposalTextarea({
  ariaLabel,
  className,
  disabled,
  draft,
  sizingSuffix,
  onDraftChange,
  onSaveEdit,
  onDiscardEdit,
}: {
  ariaLabel: string;
  className: string | undefined;
  disabled: boolean;
  draft: string;
  sizingSuffix: string | undefined;
  onDraftChange: (value: string) => void;
  onSaveEdit: () => void;
  onDiscardEdit: () => void;
}) {
  return (
    <div data-capture-keyboard>
      <AutoGrowTextarea
        ariaLabel={ariaLabel}
        autoFocus
        className={className}
        disabled={disabled}
        onChange={onDraftChange}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onDiscardEdit();
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSaveEdit();
          }
        }}
        sizingSuffix={sizingSuffix}
        value={draft}
      />
    </div>
  );
}

function dialogueSpeaker(
  displayName: string | null,
  characters: Character[],
): Character | null {
  if (displayName === null) return null;
  const normalized = displayName.toLowerCase();
  return (
    characters.find((character) => character.name.toLowerCase() === normalized) ??
    null
  );
}

function DialogueSpeaker({
  displayName,
  characters,
}: {
  displayName: string | null;
  characters: Character[];
}) {
  if (displayName === null) return null;
  const character = dialogueSpeaker(displayName, characters);
  return (
    <TypographyEyebrow className="flex items-center gap-1.5">
      {character === null ? null : <ColorDot color={character.color} />}
      {displayName}
    </TypographyEyebrow>
  );
}

function DialogueTail({
  changeId,
  segments,
}: {
  changeId: string;
  segments: DialogueSegment[];
}) {
  return segments.map((segment, index) =>
    segment.kind === "quote" ? (
      <TypographyP
        className={cn(PROSE, DIALOGUE_INDENT, COMPACT_PARAGRAPH)}
        key={`${changeId}:segment:${index}`}
      >
        <span aria-hidden className={DIALOGUE_QUOTE}>
          {'"'}
        </span>
        {renderInline(segment.text)}
        <span className="text-faint">{'"'}</span>
      </TypographyP>
    ) : (
      <TypographyP
        className={cn(DIALOGUE_BEAT, COMPACT_PARAGRAPH)}
        key={`${changeId}:segment:${index}`}
      >
        {renderInline(segment.text)}
      </TypographyP>
    ),
  );
}

function InsertPreview({
  row,
  characters,
}: {
  row: Extract<ManuscriptReviewRow, { kind: "insert" }>;
  characters: Character[];
}) {
  const change = row.change.change;
  const value = requiredText(change.newText, row.changeId);
  switch (change.type) {
    case "narration":
      return (
        <TypographyP className={cn(PROSE, COMPACT_PARAGRAPH)}>
          {renderInline(value)}
        </TypographyP>
      );
    case "dialogue":
      return (
        <div className="flex flex-col gap-1">
          <DialogueSpeaker
            characters={characters}
            displayName={change.speaker}
          />
          <TypographyP
            className={cn(PROSE, DIALOGUE_INDENT, COMPACT_PARAGRAPH)}
          >
            <span aria-hidden className={DIALOGUE_QUOTE}>
              {'"'}
            </span>
            {renderInline(value)}
            <span className="text-faint">{'"'}</span>
          </TypographyP>
          <DialogueTail
            changeId={row.changeId}
            segments={change.segments ?? []}
          />
        </div>
      );
    case null:
      throw new Error(`Insert change ${row.changeId} requires a block type.`);
    default:
      return assertNever(change.type);
  }
}

function InsertEditor({
  row,
  characters,
  disabled,
  draft,
  onDraftChange,
  onSaveEdit,
  onDiscardEdit,
}: {
  row: Extract<ManuscriptReviewRow, { kind: "insert" }>;
  characters: Character[];
  disabled: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSaveEdit: () => void;
  onDiscardEdit: () => void;
}) {
  const change = row.change.change;
  switch (change.type) {
    case "narration":
      return (
        <EditSurface>
          <ProposalTextarea
            ariaLabel="Edit proposed insert"
            className={PROSE}
            disabled={disabled}
            draft={draft}
            onDiscardEdit={onDiscardEdit}
            onDraftChange={onDraftChange}
            onSaveEdit={onSaveEdit}
            sizingSuffix={undefined}
          />
        </EditSurface>
      );
    case "dialogue":
      return (
        <div className="flex flex-col gap-1">
          <DialogueSpeaker
            characters={characters}
            displayName={change.speaker}
          />
          <EditSurface>
            <div className={cn(PROSE, DIALOGUE_INDENT)}>
              <span aria-hidden className={DIALOGUE_QUOTE}>
                {'"'}
              </span>
              <ProposalTextarea
                ariaLabel="Edit proposed insert"
                className={undefined}
                disabled={disabled}
                draft={draft}
                onDiscardEdit={onDiscardEdit}
                onDraftChange={onDraftChange}
                onSaveEdit={onSaveEdit}
                sizingSuffix={'"'}
              />
            </div>
          </EditSurface>
          <DialogueTail
            changeId={row.changeId}
            segments={change.segments ?? []}
          />
        </div>
      );
    case null:
      throw new Error(`Insert change ${row.changeId} requires a block type.`);
    default:
      return assertNever(change.type);
  }
}

function RewriteEditor({
  row,
  disabled,
  draft,
  onDraftChange,
  onSaveEdit,
  onDiscardEdit,
}: {
  row: Extract<ManuscriptReviewRow, { kind: "rewrite" }>;
  disabled: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSaveEdit: () => void;
  onDiscardEdit: () => void;
}) {
  // The diff holds its preview-mode position and just re-diffs against the
  // draft, so entering edit mode reads as a field opening beneath it rather
  // than as the card reflowing.
  return (
    <div className="flex flex-col gap-3">
      <AgentDiffPreview
        after={draft}
        before={row.beforeText}
        className={PROSE}
      />
      <EditSurface>
        <ProposalTextarea
          ariaLabel="Edit proposed rewrite"
          className={PROSE}
          disabled={disabled}
          draft={draft}
          onDiscardEdit={onDiscardEdit}
          onDraftChange={onDraftChange}
          onSaveEdit={onSaveEdit}
          sizingSuffix={undefined}
        />
      </EditSurface>
    </div>
  );
}

function ProposalDecisionControls({
  changeId,
  disabled,
  text,
  onBeginEdit,
  onAccept,
  onReject,
}: {
  changeId: string;
  disabled: boolean;
  text: string;
  onBeginEdit: (changeId: string, text: string) => void;
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        disabled={disabled}
        onClick={() => onBeginEdit(changeId, text)}
        size="sm"
        variant="outline"
      >
        <IconEdit data-icon="inline-start" />
        Edit proposal
      </Button>
      <DecisionControls
        acceptDisabled={false}
        changeId={changeId}
        disabled={disabled}
        onAccept={onAccept}
        onReject={onReject}
      />
    </div>
  );
}

export function ManuscriptReviewChange({
  row,
  characters,
  disabled,
  draft,
  onBeginEdit,
  onDraftChange,
  onSaveEdit,
  onDiscardEdit,
  onAccept,
  onReject,
}: ManuscriptReviewChangeProps) {
  switch (row.kind) {
    case "unchanged":
      return (
        <BlockBody
          block={row.block}
          editing={false}
          hit={null}
          speaker={findSpeaker(row.block, characters)}
        />
      );
    case "rewrite": {
      const proposed = requiredText(row.change.change.newText, row.changeId);
      return (
        <div className="flex flex-col gap-3">
          <ChangeHeading row={row} />
          {draft === null ? (
            <AgentDiffPreview
              after={proposed}
              before={row.beforeText}
              className={PROSE}
            />
          ) : (
            <RewriteEditor
              disabled={disabled}
              draft={draft}
              onDiscardEdit={onDiscardEdit}
              onDraftChange={onDraftChange}
              onSaveEdit={onSaveEdit}
              row={row}
            />
          )}
          <ChangeReason reason={row.change.change.reason} />
          {draft === null ? (
            <ProposalDecisionControls
              changeId={row.changeId}
              disabled={disabled}
              onAccept={onAccept}
              onBeginEdit={onBeginEdit}
              onReject={onReject}
              text={proposed}
            />
          ) : (
            <EditControls
              disabled={disabled}
              onDiscardEdit={onDiscardEdit}
              onSaveEdit={onSaveEdit}
            />
          )}
        </div>
      );
    }
    case "insert":
      return (
        <div className="flex flex-col gap-3">
          <ChangeHeading row={row} />
          {draft === null ? (
            <InsertPreview characters={characters} row={row} />
          ) : (
            <InsertEditor
              characters={characters}
              disabled={disabled}
              draft={draft}
              onDiscardEdit={onDiscardEdit}
              onDraftChange={onDraftChange}
              onSaveEdit={onSaveEdit}
              row={row}
            />
          )}
          <ChangeReason reason={row.change.change.reason} />
          {draft === null ? (
            <ProposalDecisionControls
              changeId={row.changeId}
              disabled={disabled}
              onAccept={onAccept}
              onBeginEdit={onBeginEdit}
              onReject={onReject}
              text={requiredText(row.change.change.newText, row.changeId)}
            />
          ) : (
            <EditControls
              disabled={disabled}
              onDiscardEdit={onDiscardEdit}
              onSaveEdit={onSaveEdit}
            />
          )}
        </div>
      );
    case "remove":
      return (
        <div className="flex flex-col gap-3">
          <ChangeHeading row={row} />
          <del className="block text-destructive line-through decoration-destructive">
            <BlockBody
              block={row.source}
              editing={false}
              hit={null}
              speaker={findSpeaker(row.source, characters)}
            />
          </del>
          <ChangeReason reason={row.change.change.reason} />
          <DecisionControls
            acceptDisabled={false}
            changeId={row.changeId}
            disabled={disabled}
            onAccept={onAccept}
            onReject={onReject}
          />
        </div>
      );
    case "move-source":
      return (
        <div className="flex flex-col gap-2">
          <ChangeHeading row={row} />
          <BlockBody
            block={row.source}
            editing={false}
            hit={null}
            speaker={findSpeaker(row.source, characters)}
          />
        </div>
      );
    case "move-destination":
      return (
        <div className="flex flex-col gap-3">
          <ChangeHeading row={row} />
          <BlockBody
            block={row.source}
            editing={false}
            hit={null}
            speaker={findSpeaker(row.source, characters)}
          />
          <ChangeReason reason={row.change.change.reason} />
          <DecisionControls
            acceptDisabled={false}
            changeId={row.changeId}
            disabled={disabled}
            onAccept={onAccept}
            onReject={onReject}
          />
        </div>
      );
    case "stale": {
      const change = row.change.change;
      const proposedText =
        change.kind === "rewrite" || change.kind === "insert"
          ? requiredText(change.newText, row.changeId)
          : null;
      return (
        <div className="flex flex-col gap-3">
          <ChangeHeading row={row} />
          <TypographyP
            className={cn("whitespace-pre-wrap", COMPACT_PARAGRAPH)}
          >
            {row.frozenText}
          </TypographyP>
          {proposedText === null ? null : (
            <TypographyP
              className={cn("whitespace-pre-wrap", COMPACT_PARAGRAPH)}
            >
              {proposedText}
            </TypographyP>
          )}
          <ChangeReason reason={change.reason} />
          <TypographyMuted className="text-destructive">
            Source changed - regenerate
          </TypographyMuted>
          {proposedText === null ? null : (
            <Button disabled size="sm" variant="outline">
              <IconEdit data-icon="inline-start" />
              Edit proposal
            </Button>
          )}
          <DecisionControls
            acceptDisabled
            changeId={row.changeId}
            disabled={disabled}
            onAccept={onAccept}
            onReject={onReject}
          />
        </div>
      );
    }
    default:
      return assertNever(row);
  }
}
