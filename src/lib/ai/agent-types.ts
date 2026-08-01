import type { LanguageModelUsage, UIMessage } from "ai";
import type {
  Block,
  BlockChange,
  Card,
  CritiqueNote,
  ContinuityFlag,
  ProjectMeta,
  SculptChange,
} from "@/lib/types";

export type AgentMode = "writing" | "edit";

export type DraftContextRef =
  | { kind: "block"; chapterId: string; blockId: string }
  | { kind: "outline-card"; chapterId: string; cardId: string }
  | { kind: "finding"; chapterId: string; findingId: string };

export interface ContextSnapshot {
  id: string;
  kind: DraftContextRef["kind"];
  chapterId: string;
  sourceId: string;
  order: number;
  sourceType: string;
  label: string;
  exactText: string;
  sourceFingerprint: string;
}

export interface DraftSourceLocator {
  order: number;
  sourceFingerprint: string;
}

export interface DraftContextSource {
  ref: DraftContextRef;
  available: boolean;
  label: string;
  preview: string;
  resolved: Omit<ContextSnapshot, "id"> | null;
}

export interface DraftContextAttachment {
  ref: DraftContextRef;
  revision: number;
}

export interface SubmittedAgentDraft {
  text: string;
  textRevision: number;
  attachments: DraftContextAttachment[];
}

export type AgentTask =
  | { kind: "conversation"; targetChapterId: string | null }
  | {
      kind: "bridge";
      chapterId: string;
      anchorBlockId: string;
      successorBlockId: string | null;
    }
  | {
      kind: "selected-block-edit";
      chapterId: string;
      blockIds: string[];
      operation: "clean" | "structure" | "custom";
    }
  | {
      kind: "chapter-analysis";
      chapterId: string;
      analysis: "critique" | "continuity";
    }
  | { kind: "outline-sculpt"; chapterId: string }
  | { kind: "proposal-follow-up"; proposalId: string };

export interface AgentRun {
  id: string;
  projectRoot: string;
  mode: AgentMode;
  task: AgentTask;
  userMessageId: string;
  attachments: ContextSnapshot[];
  startedAt: string;
}

export type AgentRunStatus = "idle" | "submitted" | "streaming";

export type AgentIntent =
  | { kind: "add-context"; refs: DraftContextRef[] }
  | {
      kind: "prefill";
      mode: AgentMode;
      text: string;
      refs: DraftContextRef[];
    }
  | {
      kind: "run";
      mode: AgentMode;
      text: string;
      refs: DraftContextRef[];
      task: AgentTask;
    }
  | { kind: "focus"; mode: AgentMode };

export interface SourceLocator {
  sourceId: string;
  order: number;
  fingerprint: string;
  sourceType: string;
  label: string;
  exactText: string;
  previewText: string;
}

export type ManuscriptPrecondition =
  | { kind: "target"; target: SourceLocator }
  | {
      kind: "insert";
      anchor: SourceLocator | null;
      expectedNext: SourceLocator | null;
    }
  | {
      kind: "move";
      target: SourceLocator;
      orderFingerprint: string;
    };

export type OutlinePrecondition =
  | { kind: "card"; target: SourceLocator }
  | { kind: "outline-order"; orderFingerprint: string }
  | {
      kind: "outline-move";
      target: SourceLocator;
      orderFingerprint: string;
    };

export interface ManuscriptPendingChange {
  id: string;
  change: BlockChange;
  precondition: ManuscriptPrecondition;
}

export interface OutlinePendingChange {
  id: string;
  change: SculptChange;
  precondition: OutlinePrecondition;
}

interface PendingProposalBase {
  id: string;
  projectRoot: string;
  chapterId: string;
  summary: string;
  createdAt: string;
  originatingMessageId: string;
}

export interface ManuscriptPendingProposal extends PendingProposalBase {
  kind: "manuscript";
  changes: ManuscriptPendingChange[];
}

export interface OutlinePendingProposal extends PendingProposalBase {
  kind: "outline";
  changes: OutlinePendingChange[];
}

export type PendingProposal =
  | ManuscriptPendingProposal
  | OutlinePendingProposal;

export type PersistedPendingProposal =
  | Omit<ManuscriptPendingProposal, "projectRoot">
  | Omit<OutlinePendingProposal, "projectRoot">;

export type AgentProposalApplyResult =
  | { status: "applied"; appliedChangeIds: string[] }
  | { status: "stale"; staleChangeIds: string[] }
  | {
      status: "invalid";
      invalidChangeIds: string[];
      reason: AgentProposalInvalidReason;
    };

export type AgentProposalInvalidReason =
  | "unknown-selection"
  | "mismatched-precondition"
  | "conflicting-changes"
  | "apply-failed";

export interface OutlineUndoToken {
  id: string;
  projectRoot: string;
  before: ProjectMeta;
  afterFingerprint: string;
}

export type AgentOutlineApplyResult =
  | {
      status: "applied";
      appliedChangeIds: string[];
      undoToken: OutlineUndoToken;
    }
  | { status: "stale"; staleChangeIds: string[] }
  | {
      status: "invalid";
      invalidChangeIds: string[];
      reason: AgentProposalInvalidReason;
    };

export interface PersistedUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow: number;
  raw: LanguageModelUsage;
}

export interface InterruptedRun {
  runId: string;
  userMessageId: string;
  assistantMessageId: string | null;
  reason: "stopped" | "project-switch" | "app-exit";
  interruptedAt: string;
}

export type AgentMessageState =
  | "complete"
  | "streaming"
  | "stopped"
  | "error";

export type AgentErrorCode =
  | "configuration"
  | "transport"
  | "tool"
  | "compaction"
  | "transition"
  | "unknown";

export interface AgentRunError {
  code: AgentErrorCode;
  message: string;
}

export interface AgentPersistenceIssue {
  kind: "corrupt" | "load" | "save";
  projectRoot: string;
  message: string;
}

export interface AgentMessageMetadata {
  runId: string;
  mode: AgentMode;
  task: AgentTask;
  state: AgentMessageState;
  createdAt: string;
  error: string | null;
  errorCode: AgentErrorCode | null;
  retryOf: string | null;
  usage: PersistedUsage | null;
}

export interface ProposalEventData {
  proposalId: string;
  action: "staged" | "accepted" | "accepted-all" | "rejected" | "rejected-all";
  changeCount: number;
  text: string;
}

export interface AgentDataParts {
  context: { snapshots: ContextSnapshot[] };
  "proposal-event": ProposalEventData;
  compaction: { throughMessageId: string; text: string };
  findings: {
    kind: "critique" | "continuity";
    chapterId: string;
    items: Array<CritiqueNote | ContinuityFlag>;
  };
}

export interface AgentToolSummary {
  label: string;
  target: string;
  detail: string;
  itemCount: number;
}

export type AgentToolOutput<T> =
  | { kind: "runtime"; summary: AgentToolSummary; value: T }
  | { kind: "summary"; summary: AgentToolSummary };

export interface ChapterToolValue {
  chapterId: string;
  title: string;
  blocks: Array<{
    id: string;
    order: number;
    type: Block["type"];
    text: string;
    fingerprint: string;
  }>;
}

export interface OutlineToolValue {
  premise: string;
  chapters: Array<{
    chapterId: string;
    title: string;
    cards: Array<{
      id: string;
      order: number;
      title: string;
      intention: string;
      fingerprint: string;
    }>;
  }>;
}

export interface LoreToolValue {
  entries: Array<{
    id: string;
    title: string;
    description: string;
    tags: string[];
  }>;
}

export interface ConversationContextToolValue {
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    excerpt: string;
    snapshots: ContextSnapshot[];
  }>;
}

export interface PendingProposalToolValue {
  id: string;
  kind: PendingProposal["kind"];
  chapterId: string;
  summary: string;
  changes: Array<{
    id: string;
    change: BlockChange | SculptChange;
    precondition: ManuscriptPrecondition | OutlinePrecondition;
  }>;
}

export interface AgentUiTools {
  read_chapter: {
    input: { chapterId: string };
    output: AgentToolOutput<ChapterToolValue>;
  };
  read_outline: {
    input: { chapterId: string | null };
    output: AgentToolOutput<OutlineToolValue>;
  };
  read_lore: {
    input: { query: string | null };
    output: AgentToolOutput<LoreToolValue>;
  };
  run_critique: {
    input: { chapterId: string; focus: string | null };
    output: AgentToolOutput<{ findings: CritiqueNote[] }>;
  };
  run_continuity: {
    input: { chapterId: string; focus: string | null };
    output: AgentToolOutput<{ findings: ContinuityFlag[] }>;
  };
  read_conversation_context: {
    input: { messageIds: string[] };
    output: AgentToolOutput<ConversationContextToolValue>;
  };
  read_pending_proposal: {
    input: { proposalId: string };
    output: AgentToolOutput<PendingProposalToolValue>;
  };
  stage_manuscript_proposal: {
    input: { summary: string; changes: BlockChange[] };
    output: AgentToolOutput<{ proposalId: string; changeCount: number }>;
  };
  stage_outline_proposal: {
    input: { summary: string; changes: SculptChange[] };
    output: AgentToolOutput<{ proposalId: string; changeCount: number }>;
  };
}

export type AgentUIMessage = UIMessage<
  AgentMessageMetadata,
  { [Key in keyof AgentDataParts]: AgentDataParts[Key] },
  { [Key in keyof AgentUiTools]: AgentUiTools[Key] }
>;

export interface ConversationSummary {
  text: string;
  throughMessageId: string;
}

interface AgentPersistenceState<Proposal> {
  v: 3;
  mode: AgentMode;
  messages: AgentUIMessage[];
  summary: ConversationSummary | null;
  draftText: string;
  draftContextRefs: DraftContextRef[];
  draftSourceLocators: Record<string, DraftSourceLocator>;
  pendingProposal: Proposal | null;
  lastUsage: PersistedUsage | null;
  interruptedRun: InterruptedRun | null;
}

export type PersistedAgentState = AgentPersistenceState<PendingProposal>;

export type PersistedAgentSnapshot =
  AgentPersistenceState<PersistedPendingProposal>;

export interface ContextSourceResolver {
  resolveBlock: (
    chapterId: string,
    blockId: string,
    locator: DraftSourceLocator | null,
  ) => { chapterId: string; order: number; block: Block } | null;
  resolveOutlineCard: (
    chapterId: string,
    cardId: string,
    locator: DraftSourceLocator | null,
  ) => { chapterId: string; order: number; card: Card } | null;
  resolveFinding: (
    chapterId: string,
    findingId: string,
    locator: DraftSourceLocator | null,
  ) => {
    chapterId: string;
    order: number;
    finding: CritiqueNote | ContinuityFlag;
  } | null;
}
