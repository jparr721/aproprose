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
import type { Block, Character, DialogueSegment } from "@/lib/types";
import { cn } from "@/lib/utils";

const COMPACT_PARAGRAPH = "[&:not(:first-child)]:mt-0";

export interface ManuscriptReviewChangeProps {
  row: ManuscriptReviewRow;
  characters: Character[];
  disabled: boolean;
  editingRewrite: boolean;
  onBeginRewriteEdit: (changeId: string) => void;
  onEndRewriteEdit: () => void;
  onTextChange: (changeId: string, value: string) => void;
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

function ProposalTextarea({
  ariaLabel,
  changeId,
  className,
  disabled,
  autoFocus,
  onBlur,
  sizingSuffix,
  value,
  onTextChange,
}: {
  ariaLabel: string;
  changeId: string;
  className: string | undefined;
  disabled: boolean;
  autoFocus: boolean;
  onBlur: (() => void) | undefined;
  sizingSuffix: string | undefined;
  value: string;
  onTextChange: (changeId: string, value: string) => void;
}) {
  return (
    <div data-capture-keyboard onBlur={onBlur}>
      <AutoGrowTextarea
        ariaLabel={ariaLabel}
        autoFocus={autoFocus}
        className={className}
        disabled={disabled}
        onChange={(nextValue) => onTextChange(changeId, nextValue)}
        sizingSuffix={sizingSuffix}
        value={value}
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

function InsertBody({
  row,
  characters,
  disabled,
  onTextChange,
}: {
  row: Extract<ManuscriptReviewRow, { kind: "insert" }>;
  characters: Character[];
  disabled: boolean;
  onTextChange: (changeId: string, value: string) => void;
}) {
  const change = row.change.change;
  const value = requiredText(change.newText, row.changeId);
  switch (change.type) {
    case "narration":
      return (
        <ProposalTextarea
          ariaLabel="Edit proposed insert"
          autoFocus={false}
          changeId={row.changeId}
          className={PROSE}
          disabled={disabled}
          onTextChange={onTextChange}
          onBlur={undefined}
          sizingSuffix={undefined}
          value={value}
        />
      );
    case "dialogue":
      return (
        <div className="flex flex-col gap-1">
          <DialogueSpeaker
            characters={characters}
            displayName={change.speaker}
          />
          <div className={cn(PROSE, DIALOGUE_INDENT)}>
            <span aria-hidden className={DIALOGUE_QUOTE}>
              {'"'}
            </span>
            <ProposalTextarea
              ariaLabel="Edit proposed insert"
              autoFocus={false}
              changeId={row.changeId}
              className={undefined}
              disabled={disabled}
              onTextChange={onTextChange}
              onBlur={undefined}
              sizingSuffix={'"'}
              value={value}
            />
          </div>
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
  characters,
  disabled,
  onEndRewriteEdit,
  onTextChange,
}: {
  row: Extract<ManuscriptReviewRow, { kind: "rewrite" }>;
  characters: Character[];
  disabled: boolean;
  onEndRewriteEdit: () => void;
  onTextChange: (changeId: string, value: string) => void;
}) {
  const original: Block = Object.assign({}, row.source, {
    id: `review:${row.changeId}:rewrite-original`,
    text: row.beforeText,
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <TypographyEyebrow>Original</TypographyEyebrow>
        <BlockBody
          block={original}
          editing={false}
          hit={null}
          speaker={findSpeaker(original, characters)}
        />
      </div>
      <ProposalTextarea
        ariaLabel="Edit proposed rewrite"
        autoFocus
        changeId={row.changeId}
        className={PROSE}
        disabled={disabled}
        onBlur={onEndRewriteEdit}
        onTextChange={onTextChange}
        sizingSuffix={undefined}
        value={requiredText(row.change.change.newText, row.changeId)}
      />
    </div>
  );
}

function RewriteDecisionControls({
  changeId,
  disabled,
  onBeginRewriteEdit,
  onAccept,
  onReject,
}: {
  changeId: string;
  disabled: boolean;
  onBeginRewriteEdit: (changeId: string) => void;
  onAccept: (changeId: string) => void;
  onReject: (changeId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        disabled={disabled}
        onClick={() => onBeginRewriteEdit(changeId)}
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
  editingRewrite,
  onBeginRewriteEdit,
  onEndRewriteEdit,
  onTextChange,
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
    case "rewrite":
      return (
        <div className="flex flex-col gap-3">
          <ChangeHeading row={row} />
          {editingRewrite ? (
            <RewriteEditor
              characters={characters}
              disabled={disabled}
              onEndRewriteEdit={onEndRewriteEdit}
              onTextChange={onTextChange}
              row={row}
            />
          ) : (
            <AgentDiffPreview
              after={requiredText(row.change.change.newText, row.changeId)}
              before={row.beforeText}
            />
          )}
          <ChangeReason reason={row.change.change.reason} />
          <RewriteDecisionControls
            changeId={row.changeId}
            disabled={disabled}
            onBeginRewriteEdit={onBeginRewriteEdit}
            onAccept={onAccept}
            onReject={onReject}
          />
        </div>
      );
    case "insert":
      return (
        <div className="flex flex-col gap-3">
          <ChangeHeading row={row} />
          <InsertBody
            characters={characters}
            disabled={disabled}
            onTextChange={onTextChange}
            row={row}
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
          {change.kind === "rewrite" ? (
            <Button disabled size="sm" variant="outline">
              <IconEdit data-icon="inline-start" />
              Edit proposal
            </Button>
          ) : null}
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
