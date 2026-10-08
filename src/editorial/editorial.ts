import type { AgentConsoleData } from "@/stores/agent-console-store";
import type { AgentSubmissionOutcome } from "@/lib/ai/agent-controller";

export interface ChapterInvestigation {
  projectRoot: string;
  chapterId: string;
  signal: AbortSignal;
}

export interface EditorialDependencies {
  hydrate: (projectRoot: string, chapterId: string) => Promise<void>;
  read: (chapterId: string) => AgentConsoleData;
  ownsProject: (projectRoot: string) => boolean;
  isReady: (state: AgentConsoleData, projectRoot: string) => boolean;
  start: (chapterId: string) => Promise<AgentSubmissionOutcome>;
}

export type InvestigationOutcome =
  | { kind: "resumed" | "cancelled" | "unavailable" }
  | { kind: "started"; outcome: AgentSubmissionOutcome };

export function canStartChapterInvestigation(state: AgentConsoleData): boolean {
  return state.messages.length === 0 && state.summary === null &&
    state.pendingProposal === null && state.proposalRecords.length === 0 &&
    state.interruptedRun === null && state.runStatus === "idle";
}

export class Editorial {
  constructor(private readonly dependencies: EditorialDependencies) {}

  async investigateChapter(input: ChapterInvestigation): Promise<InvestigationOutcome> {
    await this.dependencies.hydrate(input.projectRoot, input.chapterId);
    if (input.signal.aborted || !this.dependencies.ownsProject(input.projectRoot)) {
      return { kind: "cancelled" };
    }
    const state = this.dependencies.read(input.chapterId);
    if (!this.dependencies.isReady(state, input.projectRoot) || state.persistenceIssue !== null) {
      return { kind: "unavailable" };
    }
    if (!canStartChapterInvestigation(state)) {
      return { kind: "resumed" };
    }
    return { kind: "started", outcome: await this.dependencies.start(input.chapterId) };
  }
}
