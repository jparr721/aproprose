"use client";

import { memo, type ComponentProps, type ReactNode } from "react";
import { IconChevronDown, IconPoint, IconTool, type TablerIcon } from "@tabler/icons-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type ChainOfThoughtProps = ComponentProps<typeof Collapsible>;

export const ChainOfThought = memo(
  ({ className, ...props }: ChainOfThoughtProps) => (
    <Collapsible
      className={cn("not-prose w-full space-y-4", className)}
      {...props}
    />
  ),
);

export type ChainOfThoughtHeaderProps = ComponentProps<typeof CollapsibleTrigger>;

export const ChainOfThoughtHeader = memo(
  ({ className, children, ...props }: ChainOfThoughtHeaderProps) => (
    <CollapsibleTrigger
      className={cn(
        "group flex w-full items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
      {...props}
    >
      <IconTool className="size-4" />
      <span className="flex flex-1 items-center gap-2 text-left">{children}</span>
      <IconChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  ),
);

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: TablerIcon;
  label: ReactNode;
  description?: ReactNode;
  status?: "complete" | "active" | "pending";
};

const stepStatusStyles: Record<NonNullable<ChainOfThoughtStepProps["status"]>, string> = {
  active: "text-foreground",
  complete: "text-muted-foreground",
  pending: "text-muted-foreground/50",
};

export const ChainOfThoughtStep = memo(
  ({ className, icon, label, description, status, children, ...props }: ChainOfThoughtStepProps) => {
    const Icon = icon ?? IconPoint;
    return (
      <div className={cn("flex gap-2 text-sm", stepStatusStyles[status ?? "complete"], className)} {...props}>
        <div className="relative mt-0.5">
          <Icon className="size-4" />
          <div className="absolute bottom-0 left-1/2 top-7 -mx-px w-px bg-border" />
        </div>
        <div className="flex-1 space-y-2 overflow-hidden">
          <div>{label}</div>
          {description === undefined ? null : <div className="text-xs text-muted-foreground">{description}</div>}
          {children}
        </div>
      </div>
    );
  },
);

export type ChainOfThoughtContentProps = ComponentProps<typeof CollapsibleContent>;

export const ChainOfThoughtContent = memo(
  ({ className, ...props }: ChainOfThoughtContentProps) => (
    <CollapsibleContent
      className={cn(
        "mt-2 space-y-3 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  ),
);

ChainOfThought.displayName = "ChainOfThought";
ChainOfThoughtHeader.displayName = "ChainOfThoughtHeader";
ChainOfThoughtStep.displayName = "ChainOfThoughtStep";
ChainOfThoughtContent.displayName = "ChainOfThoughtContent";
