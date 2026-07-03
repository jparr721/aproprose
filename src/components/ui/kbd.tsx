import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-6 w-fit min-w-6 items-center justify-center gap-1 rounded-md border border-border bg-background px-1.5 text-sm font-medium text-foreground select-none in-data-[slot=tooltip-content]:border-background/30 in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 in-data-[variant=default]:border-primary-foreground/40 in-data-[variant=default]:bg-primary-foreground/20 in-data-[variant=default]:text-primary-foreground [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
