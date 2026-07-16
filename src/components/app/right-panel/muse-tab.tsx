// muse-tab.tsx -- the Muse agent tab: a directive composer over a tool-loop
// agent run (runAgent). Muse never edits the manuscript itself: a finished run
// stages its ManuscriptProposal into the matching Edit cache entry, where the
// author reviews and applies it change by change. Runs are ephemeral
// (muse-store); only the staged proposal persists, via ai-cache-store.

import { useState } from "react";
import { IconCheck, IconPencil, IconPlayerStop, IconTrash, IconWand } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { TypographyMuted } from "@/components/ui/typography";
import {
  PromptInputProvider,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { selectionTargetIds, useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useMuseStore, type MuseRun } from "@/stores/muse-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { useAiActivityStore } from "@/stores/ai-activity-store";
import { dispatchAiIntent } from "@/stores/ai-intent-store";
import { useAiIntent } from "@/hooks/use-ai-intent";
import { aiCacheKey } from "@/lib/ai/cache-key";
import { buildEditRequest } from "@/lib/ai/context";
import { editComposerState } from "@/lib/ai/edit-composer";
import { PICK_UP_AND_GO_DIRECTIVE, pickUpCursorSuffix } from "@/lib/ai/prompts";
import { runAgent, type MuseScope } from "@/lib/ai/agent";
import { supportsTools } from "@/lib/ai/model";
import { describeAiError, isAbortError } from "@/lib/ai/errors";
import { cn } from "@/lib/utils";
import {
  AiComposer,
  AiError,
  AskedCaption,
  PanelEmpty,
  PanelHint,
  ScopeToggle,
} from "@/components/app/right-panel/shared";

// The run's abort controller lives at module scope, not in a component ref:
// ActivePanel unmounts inactive tabs, so a ref would reset to null when the
// author switches to Edit and back mid-run, leaving Stop a no-op. One owner
// survives remounts - starting a run replaces it, Stop aborts it.
let activeController: AbortController | null = null;

function museEditCacheKey(chapterId: string, scope: MuseScope, targetIds: string[]): string {
  const selectionKey = scope === "block" ? targetIds.slice().sort().join(",") : "";
  return aiCacheKey("edit", chapterId, scope, selectionKey);
}

function MuseTabBody() {
  const status = useMuseStore((s) => s.status);
  const steps = useMuseStore((s) => s.steps);
  const error = useMuseStore((s) => s.error);
  const staged = useMuseStore((s) => s.staged);
  const directive = useMuseStore((s) => s.directive);
  const stagedScope = useMuseStore((s) => s.scope);
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const selectedId = useProjectStore((s) => s.selectedId);
  const selectedIds = useProjectStore((s) => s.selectedIds);
  // Subscribed so the gate re-evaluates live when the provider changes in
  // Settings; the copy below also names the provider that can't run tools.
  const aiProvider = useSettingsStore((s) => s.aiProvider);
  const composer = usePromptInputController();
  const [focusKey, setFocusKey] = useState(0);
  const [scope, setScope] = useState<MuseScope>("chapter");
  const running = status === "running";
  const blockTargetIds = activeChapterId
    ? buildEditRequest("block", "").blocks.map((block) => block.id)
    : [];
  const blockComposer = editComposerState({
    scope: "block",
    targetCount: blockTargetIds.length,
    hasBlockSelection: selectionTargetIds(selectedIds, selectedId).length > 0,
  });
  const composerDisabled = !activeChapterId || (scope === "block" && blockComposer.disabled);
  const composerPlaceholder = !activeChapterId
    ? "Open a chapter to direct Muse"
    : scope === "block"
      ? blockComposer.placeholder
      : "e.g. raise the tension across this scene";
  const blockLabel =
    blockTargetIds.length > 1 ? "These " + blockTargetIds.length + " blocks" : "This block";

  const begin = (text: string, retryRun: MuseRun | null) => {
    const trimmed = text.trim();
    if (!trimmed || useMuseStore.getState().status === "running") return;
    const chapterId = useProjectStore.getState().activeChapterId;
    if (chapterId === null) return;
    if (retryRun !== null && retryRun.chapterId !== chapterId) {
      useMuseStore
        .getState()
        .fail("Return to the chapter where this Muse run started before retrying.");
      return;
    }
    const run: MuseRun =
      retryRun === null
        ? {
            chapterId,
            scope,
            targetIds: scope === "block" ? [...blockTargetIds] : [],
          }
        : {
            chapterId: retryRun.chapterId,
            scope: retryRun.scope,
            targetIds: [...retryRun.targetIds],
          };
    if (run.scope === "block" && run.targetIds.length === 0) return;
    const controller = new AbortController();
    activeController = controller;
    useMuseStore.getState().start(trimmed, run);
    useAiActivityStore.getState().start("muse");
    void (async () => {
      try {
        // Deliberately NOT withAiRetry: retrying an agent run re-executes its
        // tools (fresh reads, a second critique call); run once and surface
        // the error instead.
        const proposal = await runAgent(trimmed, {
          signal: controller.signal,
          onStep: (step) => useMuseStore.getState().addStep(step),
          scope: run.scope,
          targetIds: run.targetIds,
        });
        if (proposal && proposal.changes.length > 0) {
          useAiCacheStore
            .getState()
            .patch(museEditCacheKey(run.chapterId, run.scope, run.targetIds), {
              data: proposal,
              loading: false,
              error: null,
              instruction: trimmed,
            });
          useAiActivityStore.getState().finish("edit", "done");
          useMuseStore.getState().finishStaged();
        } else {
          useMuseStore.getState().finishEmpty();
        }
        useAiActivityStore.getState().finish("muse", "done");
      } catch (e) {
        if (isAbortError(e)) {
          // Author-initiated stop: back to idle. The badge clears on finish
          // because Stop is only reachable while this tab is watched.
          useMuseStore.getState().reset();
        } else {
          useMuseStore.getState().fail(describeAiError(e));
        }
        useAiActivityStore.getState().finish("muse", "failed");
      } finally {
        if (activeController === controller) activeController = null;
      }
    })();
  };

  const stop = () => activeController?.abort();

  // The one-click writer's-block helper: the same flow as an autoRun intent,
  // the canned directive plus the cursor line the dispatch sites also append
  // (the agent's read_chapter grounding does not carry the selection).
  const onPickUpAndGo = () => {
    const { selectedId, editing } = useProjectStore.getState();
    begin(PICK_UP_AND_GO_DIRECTIVE + pickUpCursorSuffix(editing ? selectedId : null), null);
  };

  const discardStaged = () => {
    const { chapterId, scope, targetIds } = useMuseStore.getState();
    if (chapterId !== null) {
      useAiCacheStore.getState().patch(museEditCacheKey(chapterId, scope, targetIds), {
        data: null,
        loading: false,
        error: null,
      });
    }
    useMuseStore.getState().reset();
  };

  // Prefill + focus on a parked intent; autoRun intents (Pick up and go)
  // start the run immediately. PromptInputProvider is prompt-input's own
  // controlled mode, so prefill needs no new AiComposer prop.
  useAiIntent("muse", (intent) => {
    if (intent.autoRun && supportsTools() && useMuseStore.getState().status !== "running") {
      begin(intent.instruction ?? "", null);
      return;
    }
    if (intent.instruction) composer.textInput.setInput(intent.instruction);
    setFocusKey((k) => k + 1);
  });

  if (!supportsTools()) {
    return (
      <div className="flex h-full flex-col">
        <PanelEmpty icon={IconWand} title="Muse needs the OpenAI provider">
          Muse works in steps with tools, and the {aiProvider} provider runs a
          local CLI that cannot exchange tool messages. Switch the AI provider
          to OpenAI in Settings to use Muse.
        </PanelEmpty>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col gap-3.5 p-4">
          <AskedCaption instruction={directive || undefined} />
          {status === "idle" ? (
            <>
              <PanelEmpty icon={IconWand} title="Direct the Muse">
                Give Muse a directive and it reads the chapter, gathers what it
                needs, and stages a reviewable set of changes in the Edit tab.
                Nothing applies without your review.
              </PanelEmpty>
              <div className="flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!activeChapterId}
                  onClick={onPickUpAndGo}
                >
                  <IconWand /> Pick up and go
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              {steps.map((step, i) => {
                const live = running && i === steps.length - 1;
                return (
                  <div key={i} className="flex items-center gap-2">
                    {live ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <IconCheck className="size-3.5 text-muted-foreground" />
                    )}
                    <TypographyMuted className={cn("text-xs", live && "text-foreground")}>
                      {step.label}
                    </TypographyMuted>
                  </div>
                );
              })}
              {running && steps.length === 0 ? (
                <div className="flex items-center gap-2">
                  <Spinner className="size-3.5" />
                  <TypographyMuted className="text-xs text-foreground">Thinking</TypographyMuted>
                </div>
              ) : null}
            </div>
          )}
          {running ? (
            <div>
              <Button size="sm" variant="outline" onClick={stop}>
                <IconPlayerStop /> Stop
              </Button>
            </div>
          ) : null}
          {status === "failed" && error ? (
            <AiError
              error={error}
              onRetry={() => {
                const { chapterId, scope, targetIds } = useMuseStore.getState();
                if (chapterId === null) return;
                begin(directive, { chapterId, scope, targetIds });
              }}
            />
          ) : null}
          {status === "done" ? (
            staged ? (
              <Card>
                <CardHeader>
                  <CardTitle>Changes staged</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-start gap-2">
                  <TypographyMuted className="text-xs">
                    Muse staged a set of changes for{" "}
                    {stagedScope === "block" ? "these selected blocks" : "this chapter"}. Review and
                    apply them change by change in the Edit tab.
                  </TypographyMuted>
                  <Button
                    size="sm"
                    onClick={() => {
                      const { scope, targetIds } = useMuseStore.getState();
                      dispatchAiIntent(
                        scope === "block"
                          ? { tab: "edit", scope: "block", blockIds: targetIds }
                          : { tab: "edit", scope: "chapter" },
                      );
                    }}
                  >
                    <IconPencil /> Review in Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={discardStaged}>
                    <IconTrash /> Discard changes
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <PanelHint>
                Muse finished without staging changes. Try a more specific
                directive.
              </PanelHint>
            )
          ) : null}
        </div>
      </div>
      <AiComposer
        placeholder={composerPlaceholder}
        loading={running}
        onSubmit={(text) => begin(text, null)}
        focusKey={focusKey}
        disabled={composerDisabled}
        anchorMode="chapter"
        toolbar={
          <ScopeToggle
            value={scope}
            options={[
              { id: "block", label: blockLabel },
              { id: "chapter", label: "Whole chapter" },
            ]}
            onChange={setScope}
            disabled={running}
          />
        }
      />
    </div>
  );
}

export function MuseTab() {
  return (
    <PromptInputProvider>
      <MuseTabBody />
    </PromptInputProvider>
  );
}
