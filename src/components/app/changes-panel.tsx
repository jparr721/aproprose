import { useEffect, useState } from "react";
import { IconArrowRight, IconCheck, IconChevronRight, IconDots, IconFileDiff, IconFileText, IconHistory, IconInfoCircle, IconPencil, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { AgentPersistenceBanner } from "@/components/app/agent-console/agent-console";
import { AgentDiffPreview } from "@/components/app/agent-console/diff-preview";
import { PROSE } from "@/components/app/block/constants";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TypographyH2, TypographyLarge, TypographyMuted, TypographyP, TypographySmall } from "@/components/ui/typography";
import { useAgentChanges, type AgentChangesEntry } from "@/hooks/use-agent-changes";
import { stopAgentRun } from "@/lib/ai/agent-controller";
import { safeAgentErrorText } from "@/lib/ai/agent-error-copy";
import { navigateToProposalChange, navigateToProposalSource } from "@/lib/ai/agent-navigation";
import type { AgentProposalRecord, ManuscriptPendingChange, OutlinePendingChange, PendingProposal } from "@/lib/ai/agent-types";
import { acceptAllProposalChanges, acceptProposalChange, proposalRequiresSourceNavigation, proposalStaleChangeIds, rejectAllProposalChanges } from "@/lib/ai/proposal-decisions";
import { cn } from "@/lib/utils";
import { agentSessionStore, pendingProposalChangeIds } from "@/stores/agent-console-store";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";

type DraftFilter = "pending" | "history";
type PreviewFormat = "prose" | "diff";

interface ChangePreview {
  id: string;
  before: string;
  sourceText: string;
  after: string;
  context: string | null;
  nextContext: string | null;
  beforeLabel: string;
  afterLabel: string;
  reason: string;
  editableText: string | null;
  tailText: string | null;
  source: ManuscriptPendingChange | OutlinePendingChange | null;
}

function manuscriptPreview(item: ManuscriptPendingChange): ChangePreview {
  const { change, precondition } = item;
  const insert = precondition.kind === "insert";
  const before = insert ? "" : precondition.target.exactText;
  let after: string | null;
  if (change.kind === "move") {
    if (change.toIndex === null) throw new Error(`Manuscript move position is missing: ${item.id}`);
    after = `Move to position ${change.toIndex + 1}`;
  } else after = change.kind === "remove" ? "" : change.newText;
  if (after === null) throw new Error(`Proposal text is missing: ${item.id}`);
  const tailText = change.kind === "insert" && change.type === "dialogue" && change.segments !== undefined && change.segments.length > 0
    ? change.segments.map((segment) => segment.text).join("\n")
    : null;
  return {
    id: item.id,
    before,
    sourceText: insert ? "" : precondition.target.previewText,
    after: tailText === null ? after : `${after}\n${tailText}`,
    context: insert && precondition.anchor !== null ? precondition.anchor.previewText : null,
    nextContext: insert && precondition.expectedNext !== null ? precondition.expectedNext.previewText : null,
    beforeLabel: insert ? precondition.anchor === null ? "Opening" : "After" : "Before",
    afterLabel: change.kind === "insert" ? "Continuation" : "After",
    reason: change.reason,
    editableText: change.kind === "insert" || change.kind === "rewrite" ? change.newText : null,
    tailText,
    source: item,
  };
}

function outlinePreview(item: OutlinePendingChange): ChangePreview {
  const { change, precondition } = item;
  const before = precondition.kind === "outline-order" ? "" : precondition.target.exactText;
  const separator = before.indexOf("\n");
  const title = separator < 0 ? before : before.slice(0, separator);
  const intention = separator < 0 ? "" : before.slice(separator + 1);
  let after: string;
  switch (change.kind) {
    case "add":
      after = [change.title, change.intention].filter((text) => text !== null).join("\n");
      break;
    case "rewrite":
      after = `${change.title === null ? title : change.title}\n${change.intention === null ? intention : change.intention}`;
      break;
    case "remove":
      after = "";
      break;
    case "move":
      if (change.toIndex === null) throw new Error(`Outline move position is missing: ${item.id}`);
      after = `Move to position ${change.toIndex + 1}`;
      break;
  }
  return {
    id: item.id,
    before,
    sourceText: precondition.kind === "outline-order" ? "" : precondition.target.previewText,
    after,
    context: null,
    nextContext: null,
    beforeLabel: change.kind === "add" ? "End of outline" : "Before",
    afterLabel: change.kind === "add" ? "New outline card" : "After",
    reason: change.reason,
    editableText: null,
    tailText: null,
    source: item,
  };
}

function proposalPreviews(proposal: PendingProposal): ChangePreview[] {
  const changes = proposal.kind === "manuscript"
    ? proposal.changes.map(manuscriptPreview)
    : proposal.kind === "outline"
      ? proposal.changes.map(outlinePreview)
      : [];
  if (proposal.overviewChange) {
    const overview = proposal.overviewChange;
    changes.push({
      id: overview.id,
      before: overview.before,
      sourceText: overview.before,
      after: overview.after,
      context: null,
      nextContext: null,
      beforeLabel: "Story overview - before",
      afterLabel: "Story overview - after",
      reason: overview.reason,
      editableText: null,
      tailText: null,
      source: null,
    });
  }
  return changes;
}

function recordStatus(record: AgentProposalRecord, changeId: string): string {
  const decision = record.decisions[changeId];
  if (decision !== undefined) return decision.status === "applied" ? "Applied" : "Dismissed";
  return record.replacedByProposalId === null ? "Pending" : "Replaced";
}

function historyLabel(record: AgentProposalRecord): string {
  if (record.replacedByProposalId !== null) return "Replaced";
  const statuses = new Set(Object.values(record.decisions).map((decision) => decision.status));
  return statuses.size === 0 ? "No changes" : statuses.size > 1 ? "Partly applied" : statuses.has("applied") ? "Applied" : "Dismissed";
}

function closeChanges(): void {
  const insidePanel = document.activeElement instanceof Element && document.activeElement.closest("[data-changes-panel]") !== null;
  useViewStore.getState().setChangesOpen(false);
  if (insidePanel) {
    const toggle = document.querySelector("[data-changes-toggle]");
    if (toggle instanceof HTMLElement) toggle.focus();
  }
}

function ChangeCard({ preview, entry, format, stale, disabled, sourceRequired, editing, onEditingChange, onDismiss, onError }: {
  preview: ChangePreview;
  entry: AgentChangesEntry;
  format: PreviewFormat;
  stale: boolean;
  disabled: boolean;
  sourceRequired: boolean;
  editing: boolean;
  onEditingChange: (changeId: string | null) => void;
  onDismiss: (changeIds: string[]) => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState(preview.after);
  const editableText = preview.editableText;
  const status = recordStatus(entry.record, preview.id);
  const pending = status === "Pending";
  const editAllowed = pending && editableText !== null && !disabled;
  const textClassName = entry.record.proposal.kind === "outline" && preview.source !== null
    ? "text-sm leading-5"
    : PROSE;
  const runAction = (action: () => void): void => {
    try {
      action();
    } catch (error) {
      onError(String(error));
    }
  };
  const navigate = (): void => {
    const proposal = entry.record.proposal;
    if (preview.source === null) {
      useViewStore.getState().openOutline();
      return;
    }
    const request = proposal.chapterId === null
      ? navigateToProposalSource(proposal)
      : navigateToProposalChange(proposal.projectRoot, proposal.chapterId, preview.source);
    void request.then((opened) => {
      if (!opened) onError("The captured source is unavailable. Your draft is still here.");
    }).catch((error) => onError(String(error)));
  };
  const save = (): void => runAction(() => {
    agentSessionStore(entry.sessionId).getState().updatePendingManuscriptText({
      proposalId: entry.record.proposal.id,
      changeId: preview.id,
      newText: text,
    });
    onEditingChange(null);
  });
  return (
    <div className="flex flex-col gap-3" data-agent-change-id={preview.id}>
      <div className="flex items-center justify-between gap-3">
        <TypographySmall className="text-xs text-muted-foreground">{preview.beforeLabel}</TypographySmall>
        <div className="flex items-center gap-2">
          {pending ? null : <TypographyMuted className="text-xs">{status}</TypographyMuted>}
          <Tooltip>
            <TooltipTrigger asChild><Button aria-label="Go to source" onClick={navigate} variant="ghost" size="icon-sm"><IconArrowRight /></Button></TooltipTrigger>
            <TooltipContent>Go to source</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {preview.sourceText || preview.context ? (
        <TypographyP className={cn(textClassName, "whitespace-pre-wrap text-muted-foreground [&:not(:first-child)]:mt-0")}>{preview.sourceText || preview.context}</TypographyP>
      ) : null}
      <Card size="sm" className="border border-success/25 bg-success/5 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><IconPlus className="size-3.5 text-success" />{preview.afterLabel}</CardTitle>
          <CardAction className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Why this change"><IconInfoCircle /></Button></TooltipTrigger>
              <TooltipContent className="max-w-72">{preview.reason}</TooltipContent>
            </Tooltip>
            {pending ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Change actions"><IconDots /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" onCloseAutoFocus={(event) => { if (editing) event.preventDefault(); }}>
                  <DropdownMenuItem disabled={disabled || stale || sourceRequired || editing} onSelect={() => runAction(() => {
                    if (entry.pendingProposal === null) throw new Error("This change is no longer pending.");
                    acceptProposalChange(entry.pendingProposal, preview.id, entry.sessionId);
                  })}><IconCheck />Apply change</DropdownMenuItem>
                  <DropdownMenuItem disabled={disabled || editing} variant="destructive" onSelect={() => onDismiss([preview.id])}><IconTrash />Dismiss change</DropdownMenuItem>
                  {editableText === null ? null : <DropdownMenuItem disabled={!editAllowed} onSelect={() => { setText(editableText); onEditingChange(preview.id); }}><IconPencil />Edit draft</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </CardAction>
        </CardHeader>
        <CardContent>
          {editing && editAllowed ? (
            <div className="flex flex-col gap-3">
              <InputGroup>
                <InputGroupTextarea autoFocus aria-label="Edit proposed text" value={text} onChange={(event) => setText(event.target.value)} className="min-h-36" />
                <InputGroupAddon align="block-end">
                  <InputGroupButton onClick={() => onEditingChange(null)} size="sm">Cancel</InputGroupButton>
                  <InputGroupButton onClick={save} size="sm" variant="default" className="ml-auto">Save draft</InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {preview.tailText === null ? null : <TypographyP className={cn(textClassName, "whitespace-pre-wrap [&:not(:first-child)]:mt-0")}>{preview.tailText}</TypographyP>}
            </div>
          ) : format === "diff" && preview.before && (preview.source === null || preview.source.change.kind !== "move") ? (
            <AgentDiffPreview before={preview.before} after={preview.after} className={textClassName} />
          ) : preview.after ? (
            <TypographyP className={cn(textClassName, "whitespace-pre-wrap [&:not(:first-child)]:mt-0")}>{preview.after}</TypographyP>
          ) : <TypographyMuted>Removed</TypographyMuted>}
        </CardContent>
      </Card>
      {stale && pending ? <TypographyMuted className="text-destructive">Source changed - review your current text before requesting a new draft.</TypographyMuted> : null}
      {preview.nextContext === null ? null : (
        <div className="flex flex-col gap-2">
          <TypographySmall className="text-xs text-muted-foreground">Followed by</TypographySmall>
          <TypographyP className={cn(textClassName, "whitespace-pre-wrap text-muted-foreground [&:not(:first-child)]:mt-0")}>{preview.nextContext}</TypographyP>
        </div>
      )}
    </div>
  );
}

function ProposalPreview({ entry, disabled, onRestored }: { entry: AgentChangesEntry; disabled: boolean; onRestored: () => void }) {
  const [format, setFormat] = useState<PreviewFormat>("prose");
  const [dismissProposal, setDismissProposal] = useState<PendingProposal | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const project = useProjectStore((state) => state.project);
  useProjectStore((state) => state.blocks);
  useProjectStore((state) => state.meta);
  useProjectStore((state) => state.activeChapterId);
  const proposal = entry.record.proposal;
  const chapter = project === null ? undefined : project.chapters.find((candidate) => candidate.id === proposal.chapterId);
  const pending = entry.pendingProposal;
  const pendingIds = pendingProposalChangeIds(entry.record);
  const sourceRequired = pending !== null && chapter !== undefined && proposalRequiresSourceNavigation(pending);
  const staleIds = pending === null ? new Set<string>() : proposalStaleChangeIds(pending);
  const dismissedIds = Object.entries(entry.record.decisions).filter(([, decision]) => decision.status === "dismissed").map(([id]) => id);
  const previews = proposalPreviews(proposal);
  const dismissCount = dismissProposal === null ? 0 : dismissProposal.changes.length + (dismissProposal.overviewChange ? 1 : 0);
  const requestDismiss = (changeIds: string[]): void => {
    if (pending === null) throw new Error("This draft is no longer pending.");
    const ids = new Set(changeIds);
    const overviewChange = pending.overviewChange && ids.has(pending.overviewChange.id) ? pending.overviewChange : null;
    if (pending.kind === "overview") {
      setDismissProposal(pending);
    } else if (pending.kind === "manuscript") {
      setDismissProposal({ ...pending, changes: pending.changes.filter((change) => ids.has(change.id)), overviewChange });
    } else {
      setDismissProposal({ ...pending, changes: pending.changes.filter((change) => ids.has(change.id)), overviewChange });
    }
  };
  const navigate = (): void => {
    setActionError(null);
    void navigateToProposalSource(proposal).then((opened) => {
      if (!opened) setActionError("The source chapter is unavailable. Your draft is still here.");
    }).catch((error) => setActionError(String(error)));
  };
  const runAction = (action: () => void): void => {
    setActionError(null);
    try { action(); } catch (error) { setActionError(String(error)); }
  };
  return (
    <div className="flex flex-col gap-5" data-draft-preview={proposal.id}>
      <div className="flex flex-col gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <TypographyH2 className="text-sm font-medium leading-5">{proposal.summary}</TypographyH2>
          <TypographyMuted className="text-xs">{proposal.kind === "overview" ? "Story overview" : chapter === undefined ? "Source chapter unavailable" : `Ch. ${chapter.label} / ${chapter.title}`}</TypographyMuted>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2" aria-label="Draft actions">
          {pending !== null ? (
            <>
              <Tooltip><TooltipTrigger asChild><Button variant="destructive" size="icon" aria-label="Dismiss draft" disabled={disabled || editingId !== null} onClick={() => requestDismiss(pendingIds)}><IconTrash /></Button></TooltipTrigger><TooltipContent>Dismiss {pendingIds.length} pending {pendingIds.length === 1 ? "change" : "changes"} in this draft</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger asChild><Button disabled={disabled || editingId !== null || sourceRequired || staleIds.size > 0} onClick={() => runAction(() => acceptAllProposalChanges(pending, entry.sessionId))}><IconCheck />{pendingIds.length === 1 ? "Apply" : `Apply ${pendingIds.length}`}</Button></TooltipTrigger><TooltipContent>Apply {pendingIds.length} pending {pendingIds.length === 1 ? "change" : "changes"} in this draft</TooltipContent></Tooltip>
            </>
          ) : dismissedIds.length > 0 && entry.record.replacedByProposalId === null ? (
            <Button variant="outline" disabled={disabled} onClick={() => runAction(() => {
              agentSessionStore(entry.sessionId).getState().restoreProposalChanges(proposal.id, dismissedIds);
              onRestored();
            })}>Restore to pending</Button>
          ) : <Button variant="outline" onClick={navigate}>{proposal.kind === "manuscript" ? "View in manuscript" : "View source"}</Button>}
        </div>
      </div>
      {actionError === null ? null : <Alert variant="destructive" role="alert"><AlertTitle>Change could not be completed</AlertTitle><AlertDescription>{actionError}</AlertDescription></Alert>}
      {sourceRequired ? <Alert><AlertTitle>Open the source chapter</AlertTitle><AlertDescription>Review this draft beside its manuscript before applying.<Button variant="outline" size="sm" onClick={navigate}>Go to source<IconArrowRight /></Button></AlertDescription></Alert> : null}
      {staleIds.size === 0 ? null : <Alert><AlertTitle>Source changed</AlertTitle><AlertDescription>This draft is preserved. Review your current text or request a new draft.</AlertDescription></Alert>}
      {entry.record.source.kind === "run" ? <TypographyMuted className="text-xs whitespace-pre-wrap">{entry.record.source.text}</TypographyMuted> : null}
      {entry.record.replacedByProposalId === null ? null : <div className="flex flex-col items-start gap-2"><TypographyMuted>This draft was replaced by a later revision.</TypographyMuted><Button variant="link" size="sm" onClick={() => {
        if (entry.record.replacedByProposalId !== null) useViewStore.getState().selectChange(entry.sessionKey, entry.record.replacedByProposalId);
      }}>View replacement<IconArrowRight /></Button></div>}
      {previews.some((preview) => preview.before !== "" && (preview.source === null || preview.source.change.kind !== "move")) ? (
        <ButtonGroup aria-label="Preview format">
          <Tooltip><TooltipTrigger asChild><Button variant={format === "prose" ? "default" : "outline"} size="sm" aria-label="Read prose" aria-pressed={format === "prose"} onClick={() => setFormat("prose")}><IconFileText /></Button></TooltipTrigger><TooltipContent>Read prose</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant={format === "diff" ? "default" : "outline"} size="sm" aria-label="Show differences" aria-pressed={format === "diff"} onClick={() => setFormat("diff")}><IconFileDiff /></Button></TooltipTrigger><TooltipContent>Show differences</TooltipContent></Tooltip>
        </ButtonGroup>
      ) : null}
      <div className="flex flex-col gap-6">
        {previews.map((preview) => <ChangeCard key={preview.id} preview={preview} entry={entry} format={format} stale={staleIds.has(preview.id)} disabled={disabled || (editingId !== null && editingId !== preview.id)} sourceRequired={sourceRequired} editing={editingId === preview.id} onEditingChange={setEditingId} onDismiss={requestDismiss} onError={setActionError} />)}
      </div>
      <AlertDialog open={dismissProposal !== null} onOpenChange={(open) => { if (!open) setDismissProposal(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Dismiss {dismissCount} pending {dismissCount === 1 ? "change" : "changes"}?</AlertDialogTitle><AlertDialogDescription>The changes move to history when this draft has no pending changes. You can restore dismissed changes for review later.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep draft</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => runAction(() => {
            if (dismissProposal === null) throw new Error("The selected draft is no longer pending.");
            rejectAllProposalChanges(dismissProposal, entry.sessionId);
            setDismissProposal(null);
          })}>Dismiss</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ChangesPanel() {
  const { records, pendingCount, runStatus, activeSessionId, persistence } = useAgentChanges();
  const selectedKey = useViewStore((state) => state.selectedChange);
  const [filter, setFilter] = useState<DraftFilter>("pending");
  const busy = runStatus !== "idle";
  const historyCount = records.length - pendingCount;
  const visible = records.filter((entry) => filter === "pending" ? entry.pendingChangeCount > 0 : entry.pendingChangeCount === 0);
  const requested = selectedKey === null ? undefined : records.find((entry) => entry.sessionKey === selectedKey.sessionKey && entry.record.proposal.id === selectedKey.proposalId);
  const selected = requested !== undefined && visible.includes(requested) ? requested : visible[0];
  const unavailable = persistence.some((entry) => entry.sessionId.kind !== "character" && !entry.available);
  const loading = persistence.some((entry) => entry.sessionId.kind !== "character" && !entry.available && entry.issue === null);
  useEffect(() => {
    if (requested !== undefined) setFilter(requested.pendingChangeCount > 0 ? "pending" : "history");
  }, [requested]);
  const switchFilter = (next: DraftFilter): void => {
    useViewStore.getState().clearChangeSelection();
    setFilter(next);
  };
  return (
    <section aria-label="Changes" data-changes-panel className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      {persistence.map((entry) => {
        if (entry.sessionId.kind === "character" || entry.issue === null) return null;
        return <AgentPersistenceBanner key={entry.sessionKey} issue={entry.issue} sessionId={entry.sessionId} subject="Changes" />;
      })}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 p-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <ButtonGroup aria-label="Draft list">
                <Tooltip><TooltipTrigger asChild><Button variant={filter === "pending" ? "default" : "outline"} size="sm" aria-label={`Pending drafts (${pendingCount})`} aria-pressed={filter === "pending"} onClick={() => switchFilter("pending")}><IconFileDiff />{pendingCount}</Button></TooltipTrigger><TooltipContent>Pending drafts</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild><Button variant={filter === "history" ? "default" : "outline"} size="sm" aria-label={`History (${historyCount})`} aria-pressed={filter === "history"} onClick={() => switchFilter("history")}><IconHistory />{historyCount}</Button></TooltipTrigger><TooltipContent>History</TooltipContent></Tooltip>
              </ButtonGroup>
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Close Changes" onClick={closeChanges}><IconX /></Button></TooltipTrigger><TooltipContent>Close panel</TooltipContent></Tooltip>
            </div>
            <div className="flex flex-col gap-2" aria-label="Saved drafts">
              {visible.map((entry) => <Button key={`${entry.sessionKey}:${entry.record.proposal.id}`} variant="ghost" aria-pressed={selected === entry} onClick={() => useViewStore.getState().selectChange(entry.sessionKey, entry.record.proposal.id)} className={cn("h-auto items-start justify-start gap-3 whitespace-normal border border-transparent px-3 py-3 text-left", selected === entry && "border-border bg-muted/60")}>
                {entry.pendingChangeCount === 0 && historyLabel(entry.record) === "Applied" ? <IconCheck className="mt-0.5 text-success" /> : <IconFileDiff className="mt-0.5 text-muted-foreground" />}
                <div className="min-w-0 flex-1"><TypographySmall className="line-clamp-2 leading-5">{entry.record.proposal.summary}</TypographySmall><TypographyMuted className="mt-1 text-xs">{entry.record.proposal.kind === "overview" ? "Story overview" : entry.record.proposal.kind === "outline" ? "Outline" : "Manuscript"}{entry.pendingChangeCount > 0 ? ` - ${entry.pendingChangeCount} pending` : ` - ${historyLabel(entry.record)}`}</TypographyMuted></div>
                <IconChevronRight className="mt-0.5 text-muted-foreground" />
              </Button>)}
            </div>
          </div>
          {busy && activeSessionId !== null && activeSessionId.kind !== "character" ? <div className="flex items-center gap-3" role="status"><Spinner className="text-ai-ink motion-reduce:animate-none" /><TypographyMuted>{runStatus === "submitted" ? "Preparing draft" : "Writing"}</TypographyMuted><Button variant="outline" size="sm" className="ml-auto" onClick={() => stopAgentRun(activeSessionId)}>Stop</Button></div> : null}
          {persistence.map((entry) => {
            if (entry.sessionId.kind !== "project" || entry.runError === null) return null;
            return <Alert key={entry.sessionKey} variant="destructive"><AlertTitle>AI request failed</AlertTitle><AlertDescription>{safeAgentErrorText(entry.runError)}<Button variant="outline" size="sm" onClick={() => useViewStore.getState().openAiConsole()}>View AI output<IconArrowRight /></Button></AlertDescription></Alert>;
          })}
          <div className="border-t border-border pt-5">
            {selected !== undefined ? <ProposalPreview key={`${selected.sessionKey}:${selected.record.proposal.id}`} entry={selected} disabled={busy} onRestored={() => { setFilter("pending"); useViewStore.getState().selectChange(selected.sessionKey, selected.record.proposal.id); }} /> : <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
              {unavailable ? <>{loading ? <Spinner className="motion-reduce:animate-none" /> : <IconInfoCircle className="size-6 text-muted-foreground" />}<TypographyLarge>{loading ? "Loading Changes" : "Changes unavailable"}</TypographyLarge><TypographyMuted>{loading ? "Loading saved AI sessions" : "Resolve the storage issue to review saved Changes."}</TypographyMuted></> : busy ? <TypographyLarge>Your draft will appear here</TypographyLarge> : <><IconCheck className="size-6 text-muted-foreground" /><TypographyLarge>{filter === "pending" ? "All caught up" : "No history yet"}</TypographyLarge><Button variant="outline" size="sm" onClick={closeChanges}>Back to writing</Button></>}
            </div>}
          </div>
        </div>
      </ScrollArea>
    </section>
  );
}
