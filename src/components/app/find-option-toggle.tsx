import type { ReactNode } from "react";
import { InputGroupButton } from "@/components/ui/input-group";

export function FindOptionToggle({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <InputGroupButton
      size="icon-xs"
      variant={active ? "secondary" : "ghost"}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {children}
    </InputGroupButton>
  );
}
