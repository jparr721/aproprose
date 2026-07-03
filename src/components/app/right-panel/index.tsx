// right-panel -- the right-side assistant. Five functions, each backed by a real
// call to the model you picked in Settings, grounded on the current scene:
//   Suggest / Edit / Critique / Brainstorm / Continuity
// Reached from a vertical icon rail on the far-right edge; clicking the active
// icon collapses the panel to just the rail. Nothing infers on its own: each
// generating function waits for an explicit composer submit (with an optional
// steering instruction); Brainstorm streams a reply per turn; Edit returns
// per-block revisions. Results are cached per scene (useAi / ai-cache-store) and
// Brainstorm threads live in brainstorm-store keyed by chapter; both persist to
// disk per project (ai-persistence). Each function lives in its own <tab>-tab.tsx
// file; shared chrome (composer, anchor, scope toggle, helpers) sits in shared.tsx.

import { useEffect } from "react";
import {
  IconListTree,
  IconMessages,
  IconNotes,
  IconPencil,
  IconSparkles,
  IconTimeline,
  IconWand,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TypographyMuted } from "@/components/ui/typography";
import { OutlineSurface } from "@/components/app/outline/outline-surface";
import { useViewStore, type AiTab } from "@/stores/view-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSettingsDialogStore, SETTINGS_TABS } from "@/stores/settings-dialog-store";
import { useAiActivityStore } from "@/stores/ai-activity-store";
import { cn } from "@/lib/utils";
import { SuggestTab } from "@/components/app/right-panel/suggest-tab";
import { EditTab } from "@/components/app/right-panel/edit-tab";
import { CritiqueTab } from "@/components/app/right-panel/critique-tab";
import { ContinuityTab } from "@/components/app/right-panel/continuity-tab";
import { BrainstormTab } from "@/components/app/right-panel/brainstorm-tab";
import { MuseTab } from "@/components/app/right-panel/muse-tab";

// -- Panel shell --------------------------------------------------------------
type TabMeta = { label: string; Icon: typeof IconSparkles };

// Keyed by AiTab: adding a member to the union without a rail entry is a type error,
// so the icon rail can never silently omit a function.
const TAB_META: Record<AiTab, TabMeta> = {
  outline: { label: "Outline", Icon: IconListTree },
  suggest: { label: "Suggest", Icon: IconSparkles },
  edit: { label: "Edit", Icon: IconPencil },
  critique: { label: "Critique", Icon: IconNotes },
  brainstorm: { label: "Brainstorm", Icon: IconMessages },
  continuity: { label: "Continuity", Icon: IconTimeline },
  muse: { label: "Muse", Icon: IconWand },
};

// The ordered list the rail renders (insertion order of the meta map).
const TABS = (Object.entries(TAB_META) as [AiTab, TabMeta][]).map(
  ([id, meta]) => ({ id, ...meta }),
);

/** Render the body for the active tab. Only the active one is mounted at a time
 *  (intentional); each body reads its data from the stores (ai-cache / brainstorm)
 *  so results survive switching tabs and panel toggles. */
function ActivePanel({ tab }: { tab: AiTab }) {
  switch (tab) {
    case "outline":
      return <OutlineSurface />;
    case "suggest":
      return <SuggestTab />;
    case "edit":
      return <EditTab />;
    case "critique":
      return <CritiqueTab />;
    case "brainstorm":
      return <BrainstormTab />;
    case "continuity":
      return <ContinuityTab />;
    case "muse":
      return <MuseTab />;
  }
}

/** Shown in place of any tab body when no AI model is selected in Settings. */
function NoModelNotice() {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-3 p-6">
      <TypographyMuted className="text-sm">
        Pick an AI model in Settings to turn on the assistant.
      </TypographyMuted>
      <Button
        size="sm"
        variant="outline"
        onClick={() => useSettingsDialogStore.getState().openWithTab(SETTINGS_TABS.AI)}
      >
        Open Settings
      </Button>
    </div>
  );
}

/** The resizable content column: cursor anchor + the active tab body. Width is
 *  owned by the parent `ResizablePanel` (App.tsx); the rail is rendered separately
 *  by `RightPanelRail`. Carries `data-right-panel` so editor shortcuts treat typing
 *  in here as an aux surface (see lib/dom.ts). */
export function RightPanelContent() {
  const tab = useViewStore((s) => s.aiTab);
  const aiModel = useSettingsStore((s) => s.aiModel);
  const hydrated = useSettingsStore((s) => s.hydrated);

  // This column mounts only while the panel is open and expanded, so whichever tab
  // is shown here is the one the author is watching: clear its finished badge.
  useEffect(() => {
    useAiActivityStore.getState().markSeen(tab);
  }, [tab]);

  return (
    <aside data-right-panel className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="min-h-0 flex-1">
        {tab === "outline" || !(hydrated && !aiModel) ? (
          <ActivePanel tab={tab} />
        ) : (
          <NoModelNotice />
        )}
      </div>
    </aside>
  );
}

/** The always-visible far-right icon rail. Switching tabs expands the content;
 *  clicking the active icon collapses it back to just this rail. */
export function RightPanelRail() {
  const tab = useViewStore((s) => s.aiTab);
  const setTab = useViewStore((s) => s.setAiTab);
  const collapsed = useViewStore((s) => s.aiCollapsed);
  const setCollapsed = useViewStore((s) => s.setAiCollapsed);
  const status = useAiActivityStore((s) => s.status);

  // Click the active icon -> collapse/expand; click another -> switch + expand.
  const pick = (id: AiTab) => {
    if (id === tab) setCollapsed(!collapsed);
    else {
      setTab(id);
      setCollapsed(false);
    }
  };

  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border bg-card py-2">
      {TABS.map(({ id, label, Icon }) => {
        const active = id === tab && !collapsed;
        // The shown tab needs no flag -- its body shows the state directly and
        // opening it marks it seen. Off-screen tabs surface a pulsing dot while a
        // job runs, a solid dot once it finishes, and a destructive dot if it failed.
        const activity = active ? undefined : status[id];
        const activityWord =
          activity === "running" ? "working" : activity === "failed" ? "failed" : "ready";
        const item = (
          <div key={id} className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={activity ? `${label} (${activityWord})` : label}
                  onClick={() => pick(id)}
                  className={cn(
                    "text-muted-foreground hover:text-foreground",
                    active && "bg-accent text-foreground",
                  )}
                >
                  <Icon className="size-[18px]" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{label}</TooltipContent>
            </Tooltip>
            {activity ? (
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute right-1 top-1 size-1.5 rounded-full",
                  activity === "running" && "animate-pulse bg-primary/70",
                  activity === "done" && "bg-primary",
                  activity === "failed" && "bg-destructive",
                )}
              />
            ) : null}
          </div>
        );
        // Divide the Outline surface from the AI tools.
        return id === "suggest"
          ? [<div key="sep" className="my-1 h-px w-5 bg-border" />, item]
          : item;
      })}
    </nav>
  );
}
