import type { AuthorContract } from "@/author";
import { authorSystem } from "@/lib/ai/author-preferences";
import {
  AGENT_ACTION_CONTRACTS,
  type AgentActionContract,
  type AgentCapability,
  type PurposeAgentAction,
} from "@/agents/action-contracts";

export interface PurposeAgentPolicy {
  readonly action: PurposeAgentAction;
  readonly promptVersion: string;
  readonly instructions: string;
  readonly capabilities: readonly AgentCapability[];
  readonly stepBudget: number;
  readonly stopAfterProposal: boolean;
}

export interface AgentInstructionInput {
  readonly applicationInstructions: string;
  readonly taskInstructions: string;
  readonly marker: string;
}

export function actionPrompt(action: PurposeAgentAction): string {
  const contract = AGENT_ACTION_CONTRACTS[action];
  return [
    `SPECIALIST CONTRACT: ${contract.promptVersion}`,
    contract.mission,
    `GROUNDING POLICY: ${contract.seed}`,
    `RESULT ASSESSMENT: ${contract.assessment}`,
  ].join("\n\n");
}

export abstract class BaseAgent {
  constructor(
    protected readonly contract: AgentActionContract,
    private readonly author: AuthorContract,
  ) {}

  protected abstract groundingPolicy(): string;
  protected abstract assessmentPolicy(): string;

  compile(input: AgentInstructionInput): PurposeAgentPolicy {
    const instructions = [
      input.applicationInstructions,
      input.marker,
      `SPECIALIST CONTRACT: ${this.contract.promptVersion}`,
      this.contract.mission,
      `GROUNDING POLICY: ${this.groundingPolicy()}`,
      `RESULT ASSESSMENT: ${this.assessmentPolicy()}`,
      input.taskInstructions,
    ].filter((part) => part.length > 0).join("\n\n");
    return Object.freeze({
      action: this.contract.action,
      promptVersion: this.contract.promptVersion,
      instructions: authorSystem(instructions, "voice+editing", this.author.preferences),
      capabilities: Object.freeze([...this.contract.capabilities]),
      stepBudget: this.contract.stepBudget,
      stopAfterProposal: this.contract.stopAfterProposal,
    });
  }
}

export class ChapterPlannerAgent extends BaseAgent {
  constructor(author: AuthorContract) {
    super(AGENT_ACTION_CONTRACTS["chapter-planner"], author);
  }

  protected groundingPolicy(): string {
    return `${this.contract.seed} Coverage of the target comes before neighboring material; retrieve omitted ranges before claiming a complete diagnosis.`;
  }

  protected assessmentPolicy(): string {
    return `${this.contract.assessment} Each question must distinguish plausible directions and explain what its answer changes. A card must name the chapter work it performs.`;
  }
}

export class WriterAgent extends BaseAgent {
  constructor(author: AuthorContract) {
    super(AGENT_ACTION_CONTRACTS.writer, author);
  }

  protected groundingPolicy(): string {
    return `${this.contract.seed} Prefer a relevant voice sample over an averaged whole-book imitation; compare viewpoint, speaker and scene function.`;
  }

  protected assessmentPolicy(): string {
    return `${this.contract.assessment} Test the draft's actual dramatic effect against the request, not only surface grammatical correctness.`;
  }
}

export class LiteraryEditorAgent extends BaseAgent {
  constructor(author: AuthorContract) {
    super(AGENT_ACTION_CONTRACTS["literary-editor"], author);
  }

  protected groundingPolicy(): string {
    return `${this.contract.seed} Test a competing explanation before calling a deliberate omission or ambiguity a defect.`;
  }

  protected assessmentPolicy(): string {
    return `${this.contract.assessment} Separate severity, confidence and taste: a personal preference alone is not a supported editorial issue.`;
  }
}

class ConfiguredAgent extends BaseAgent {
  protected groundingPolicy(): string {
    return this.contract.seed;
  }

  protected assessmentPolicy(): string {
    return this.contract.assessment;
  }
}

export function createPurposeAgent(
  action: PurposeAgentAction,
  author: AuthorContract,
): BaseAgent {
  switch (action) {
    case "chapter-planner": return new ChapterPlannerAgent(author);
    case "writer": return new WriterAgent(author);
    case "literary-editor": return new LiteraryEditorAgent(author);
    default: return new ConfiguredAgent(AGENT_ACTION_CONTRACTS[action], author);
  }
}
