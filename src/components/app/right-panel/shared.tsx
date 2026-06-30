// shared.tsx -- presentational primitives + the bottom-pinned composer shared by
// every right-panel tab. Tab-specific chrome lives in each <tab>-tab.tsx file.

import { useEffect, useRef, useState } from "react";
import { IconPlus, IconRefresh, IconSparkles, IconX } from "@tabler/icons-react";
import { ButtonGroup } from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { TypographyMuted } from "@/components/ui/typography";
import { ContextAnchor, type AnchorMode } from "@/components/app/right-panel/context-anchor";

export function AiError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
      <span className="text-destructive">Couldn't reach the model.</span>
      <span className="block max-h-40 w-full overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground">
        {error}
      </span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <IconRefresh /> Try again
      </Button>
    </div>
  );
}

export function LoadingLines({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full last:w-2/3" />
      ))}
    </div>
  );
}

/** Read-only note of the instruction that produced the shown result. */
export function AskedCaption({ instruction }: { instruction?: string }) {
  if (!instruction) return null;
  return <TypographyMuted className="text-xs">Asked: {instruction}</TypographyMuted>;
}

/** Idle / empty-state helper copy shown before (or in place of) a result. Uses
 *  foreground ink -- not muted -- so it reads clearly against the panel in every theme. */
export function PanelHint({ children }: { children: React.ReactNode }) {
  return (
    <TypographyMuted className="text-xs leading-relaxed text-foreground">
      {children}
    </TypographyMuted>
  );
}

/** Centered, full-height empty state for a generating tab before its first run --
 *  an Empty card (tinted icon, heading, description) rather than a top-aligned hint,
 *  so the idle panel reads as a clear invitation instead of a footnote. */
export function PanelEmpty({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof IconSparkles;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12 rounded-xl bg-ai-tint text-ai-ink">
          <Icon className="size-6" />
        </EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription className="text-sm">{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** A mutually-exclusive scope chooser. Generic over the scope union so each tab
 *  feeds its own options (Edit: block/chapter; Critique/Continuity: cursor/chapter)
 *  while keeping the selected id type-checked against the handler. */
export function ScopeToggle<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <ButtonGroup>
      {options.map((o) => (
        <Button
          key={o.id}
          size="sm"
          variant={value === o.id ? "default" : "outline"}
          disabled={disabled}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </Button>
      ))}
    </ButtonGroup>
  );
}

// The last Suggest focus tick the composer has acted on. Module scope so it
// survives the tab unmounting/remounting: opening Suggest from the rail leaves the
// composer collapsed, while the spark (which bumps the tick) opens + focuses the
// direction box even when it mounts the tab fresh from another surface.
let lastHandledFocusSignal = 0;

/** Bottom-pinned composer shared by every function (ai-elements/prompt-input,
 *  which owns Enter-to-submit / Shift+Enter-newline). The generating tabs
 *  (`allowEmpty`) rest as a single Generate button with the steering input tucked
 *  behind an "Add a direction" disclosure; Brainstorm and Edit keep the textarea up
 *  front because they require typed input. */
export function AiComposer({
  placeholder,
  loading,
  onSubmit,
  allowEmpty = false,
  focusSignal,
  toolbar,
  disabled,
  anchorMode,
}: {
  placeholder: string;
  loading: boolean;
  onSubmit: (text: string) => void;
  allowEmpty?: boolean;
  focusSignal?: number;
  toolbar?: React.ReactNode;
  /** Inert composer: the textarea can't be typed into (e.g. nothing to edit). */
  disabled?: boolean;
  /** What the anchor describes for this tab/scope. Defaults to the caret block. */
  anchorMode?: AnchorMode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // `allowEmpty` tabs rest collapsed; revealing the direction box swaps in the textarea.
  const [steering, setSteering] = useState(false);

  // Open + focus the direction box only on a *new* focus request (the Suggest spark
  // bumps a monotonic tick), never on a plain mount -- so opening the tab from the
  // rail stays collapsed.
  useEffect(() => {
    if (focusSignal === undefined || focusSignal === lastHandledFocusSignal) return;
    lastHandledFocusSignal = focusSignal;
    if (allowEmpty) setSteering(true);
    requestAnimationFrame(() => ref.current?.querySelector("textarea")?.focus());
  }, [focusSignal, allowEmpty]);

  return (
    <div ref={ref} className="flex shrink-0 flex-col gap-2 border-t border-border bg-card p-3">
      <ContextAnchor mode={anchorMode ?? "cursor"} />
      {toolbar}
      {allowEmpty && !steering ? (
        <div className="flex flex-col gap-1.5">
          <Button
            className="w-full"
            disabled={loading || disabled}
            onClick={() => {
              if (!loading && !disabled) onSubmit("");
            }}
          >
            {loading ? <Spinner /> : <IconSparkles />} Generate
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="mx-auto text-muted-foreground"
            disabled={loading || disabled}
            onClick={() => setSteering(true)}
          >
            <IconPlus /> Add a direction
          </Button>
        </div>
      ) : (
        <PromptInput
          onSubmit={(m) => {
            const t = m.text.trim();
            if (loading || (!t && !allowEmpty)) return;
            onSubmit(t);
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea placeholder={placeholder} disabled={loading || disabled} />
          </PromptInputBody>
          {allowEmpty ? (
            <PromptInputFooter>
              <PromptInputButton variant="ghost" onClick={() => setSteering(false)}>
                <IconX /> Clear direction
              </PromptInputButton>
              <PromptInputSubmit
                status={loading ? "submitted" : undefined}
                disabled={loading}
                size="sm"
              >
                {loading ? (
                  <Spinner />
                ) : (
                  <>
                    <IconSparkles /> Generate
                  </>
                )}
              </PromptInputSubmit>
            </PromptInputFooter>
          ) : (
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={loading ? "submitted" : undefined} />
            </PromptInputFooter>
          )}
        </PromptInput>
      )}
    </div>
  );
}
