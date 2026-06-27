// Pure orchestration for the self-update flow. No Tauri or React imports so it
// runs in the node test environment with every side effect injected. The React
// component in `src/components/app/update-checker.tsx` supplies the real deps.

export type UpdateMode = "auto" | "manual";

export interface AvailableUpdate {
  readonly currentVersion: string;
  readonly version: string;
  readonly body: string;
}

export interface UpdateFlowDeps {
  readonly isDev: boolean;
  readonly check: () => Promise<AvailableUpdate | null>;
  readonly install: (update: AvailableUpdate) => Promise<void>;
  readonly promptToInstall: (update: AvailableUpdate) => Promise<boolean>;
  readonly notifyChecking: () => void;
  readonly notifyUpToDate: () => void;
  readonly notifyError: (error: unknown) => void;
}

export async function runUpdateFlow(mode: UpdateMode, deps: UpdateFlowDeps): Promise<void> {
  if (deps.isDev) return;

  // Manual checks get immediate feedback that the check is running; auto checks
  // on launch stay silent until they have something to report.
  if (mode === "manual") deps.notifyChecking();

  let update: AvailableUpdate | null;
  try {
    update = await deps.check();
  } catch (error) {
    if (mode === "manual") deps.notifyError(error);
    return;
  }

  if (update === null) {
    if (mode === "manual") deps.notifyUpToDate();
    return;
  }

  const confirmed = await deps.promptToInstall(update);
  if (!confirmed) return;

  try {
    await deps.install(update);
  } catch (error) {
    deps.notifyError(error);
  }
}
