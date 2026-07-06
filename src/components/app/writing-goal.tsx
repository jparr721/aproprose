// writing-goal.tsx - the sidebar footer's daily writing-goal widget. Before a
// goal is set it shows a quiet "Set a writing goal" onboarding row; once set it
// shows a progress bar of today's words toward the goal that fills as you save.
// Clicking either opens a popover to edit or remove the goal. Sits above Settings.

import { useState } from "react";
import { IconCheck, IconTarget } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { DailyGoalInput } from "@/components/app/daily-goal-input";
import { useSettingsStore } from "@/stores/settings-store";
import { useStatsStore } from "@/stores/stats-store";
import { goalPercent, localDateKey, wordsToday } from "@/lib/stats/stats";
import { cn } from "@/lib/utils";

export function WritingGoal() {
  const goal = useSettingsStore((s) => s.dailyWordGoal);
  const setGoal = useSettingsStore((s) => s.setDailyWordGoal);
  const days = useStatsStore((s) => s.days);
  const [open, setOpen] = useState(false);

  const today = wordsToday(days, localDateKey(new Date()));

  const editor = (
    <PopoverContent align="start" side="top" className="w-72 gap-3">
      <PopoverHeader>
        <PopoverTitle>Daily writing goal</PopoverTitle>
        <PopoverDescription>How many words you want to write each day.</PopoverDescription>
      </PopoverHeader>
      <DailyGoalInput
        value={goal}
        submitLabel={goal === null ? "Set" : "Save"}
        onSubmit={(n) => {
          setGoal(n);
          setOpen(false);
        }}
      />
      {goal !== null ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 self-end px-2 text-muted-foreground"
          onClick={() => {
            setGoal(null);
            setOpen(false);
          }}
        >
          Remove goal
        </Button>
      ) : null}
    </PopoverContent>
  );

  if (goal === null) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton className="text-muted-foreground">
            <IconTarget />
            <span>Set a writing goal</span>
          </SidebarMenuButton>
        </PopoverTrigger>
        {editor}
      </Popover>
    );
  }

  const pct = goalPercent(today, goal);
  const done = today >= goal;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Edit daily writing goal"
          className="flex w-full flex-col gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <span
              className={cn(
                "flex items-center gap-1.5",
                done ? "text-success" : "text-muted-foreground",
              )}
            >
              {done ? <IconCheck className="size-3.5" /> : <IconTarget className="size-3.5" />}
              {done ? "Goal reached" : "Daily goal"}
            </span>
            <span className="tabular-nums text-muted-foreground">
              <span className={cn("font-medium", done ? "text-success" : "text-foreground")}>
                {today.toLocaleString()}
              </span>{" "}
              / {goal.toLocaleString()}
            </span>
          </div>
          <Progress
            value={pct}
            className={cn("h-1.5", done && "[&>[data-slot=progress-indicator]]:bg-success")}
          />
        </button>
      </PopoverTrigger>
      {editor}
    </Popover>
  );
}
