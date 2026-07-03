// agent.ts - the Muse tool-loop agent core. P3 lands this in two steps: the
// step/run types first (muse-store stores AgentSteps and the tab renders
// them), then runAgent itself with the tool loop.

export interface AgentStep {
  /** Tool name ("read_chapter", "get_critique", "stage_proposal") or "thinking". */
  tool: string;
  /** Feed line, e.g. "Reading the chapter". */
  label: string;
}

export interface AgentRunOptions {
  signal: AbortSignal;
  onStep: (step: AgentStep) => void;
}
