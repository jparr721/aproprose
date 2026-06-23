// auto-textarea.tsx — a borderless textarea that grows to fit its content, so
// editing a block feels like editing prose in place rather than a form field.

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { PROSE_BODY_ATTR } from "@/lib/prose-body";

export function AutoGrowTextarea({
  value,
  onChange,
  className,
  autoFocus,
  placeholder,
  onKeyDown,
  proseBody,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Mark this as a carve-eligible prose body (selection toolbar + split shortcut). */
  proseBody?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      rows={1}
      spellCheck
      onKeyDown={onKeyDown}
      onChange={(e) => onChange(e.currentTarget.value)}
      {...(proseBody ? { [PROSE_BODY_ATTR]: "" } : {})}
      className={cn(
        // `block` (not the default inline-block) avoids the baseline descender
        // gap that otherwise adds phantom padding below the textarea on select.
        "block w-full resize-none border-0 bg-transparent p-0 outline-none placeholder:text-faint focus:ring-0",
        className,
      )}
    />
  );
}
