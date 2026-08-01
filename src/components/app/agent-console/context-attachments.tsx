import { useState } from "react";
import {
  Attachment,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TypographyMuted, TypographyP } from "@/components/ui/typography";
import {
  contextSnapshotToSourcePart,
  draftContextRefKey,
  draftContextSourceToSourcePart,
} from "@/lib/ai/agent-context";
import type {
  ContextSnapshot,
  DraftContextRef,
  DraftContextSource,
} from "@/lib/ai/agent-types";

export interface DraftContextAttachmentsProps {
  refs: DraftContextRef[];
  sources: Record<string, DraftContextSource>;
  onRemove: (ref: DraftContextRef) => void;
  disabled: boolean;
}

export interface SentContextAttachmentsProps {
  snapshots: ContextSnapshot[];
  onNavigate: (snapshot: ContextSnapshot) => Promise<boolean>;
}

function unavailableSource(ref: DraftContextRef): DraftContextSource {
  const label =
    ref.kind === "block"
      ? "Manuscript block"
      : ref.kind === "outline-card"
        ? "Outline card"
        : "Finding";
  return {
    ref,
    available: false,
    label,
    preview: "Unavailable",
    resolved: null,
  };
}

export function DraftContextAttachments({
  refs,
  sources,
  onRemove,
  disabled,
}: DraftContextAttachmentsProps) {
  const seen = new Set<string>();
  const uniqueRefs = refs.filter((ref) => {
    const key = draftContextRefKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <Attachments variant="inline">
      {uniqueRefs.map((ref) => {
        const key = draftContextRefKey(ref);
        const source = sources[key] ?? unavailableSource(ref);
        const data = draftContextSourceToSourcePart(source);
        return (
          <AttachmentHoverCard key={key}>
            <AttachmentHoverCardTrigger asChild>
              <Attachment
                aria-label={`${source.label} context`}
                data={data}
                onRemove={() => onRemove(ref)}
                role="group"
              >
                <AttachmentPreview />
                <AttachmentInfo />
                {source.available ? null : (
                  <TypographyMuted>Unavailable</TypographyMuted>
                )}
                <AttachmentRemove
                  className="focus-visible:opacity-100 group-focus-within:opacity-100"
                  disabled={disabled}
                  label={`Remove ${source.label}`}
                />
              </Attachment>
            </AttachmentHoverCardTrigger>
            <AttachmentHoverCardContent>
              <TypographyP className="whitespace-pre-wrap">
                {source.available ? source.preview : "Unavailable"}
              </TypographyP>
            </AttachmentHoverCardContent>
          </AttachmentHoverCard>
        );
      })}
    </Attachments>
  );
}

export function SentContextAttachments({
  snapshots,
  onNavigate,
}: SentContextAttachmentsProps) {
  const [unavailable, setUnavailable] = useState<ContextSnapshot | null>(null);

  const openSnapshot = async (snapshot: ContextSnapshot): Promise<void> => {
    const didNavigate = await onNavigate(snapshot);
    if (!didNavigate) setUnavailable(snapshot);
  };

  return (
    <>
      <Attachments variant="inline">
        {snapshots.map((snapshot) => (
          <AttachmentHoverCard key={snapshot.id}>
            <AttachmentHoverCardTrigger asChild>
              <Attachment
                aria-label={`Open ${snapshot.label} context`}
                data={contextSnapshotToSourcePart(snapshot)}
                onClick={() => void openSnapshot(snapshot)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  void openSnapshot(snapshot);
                }}
                role="button"
                tabIndex={0}
              >
                <AttachmentPreview />
                <AttachmentInfo />
              </Attachment>
            </AttachmentHoverCardTrigger>
            <AttachmentHoverCardContent>
              <TypographyP className="whitespace-pre-wrap">
                {snapshot.exactText}
              </TypographyP>
            </AttachmentHoverCardContent>
          </AttachmentHoverCard>
        ))}
      </Attachments>
      <Dialog
        open={unavailable !== null}
        onOpenChange={(open) => {
          if (!open) setUnavailable(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{unavailable?.label}</DialogTitle>
            <TypographyMuted>Unavailable</TypographyMuted>
          </DialogHeader>
          {unavailable === null ? null : (
            <TypographyP className="whitespace-pre-wrap">
              {unavailable.exactText}
            </TypographyP>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
