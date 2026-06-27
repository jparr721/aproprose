// inline-edit.tsx -- a text field that looks like text and commits on blur.
//
// Holds a local draft so typing is smooth; commits to the store only when focus
// leaves and the value actually changed. Used for every editable outline field
// (premise, act summary/title, beat title/intention, chapter goal/conflict/turn).

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function InlineEdit({
  value,
  onCommit,
  placeholder,
  multiline,
  className,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder: string;
  multiline: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Re-sync when the upstream value changes (e.g. switching chapters).
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (next !== value.trim()) onCommit(next);
  };

  return (
    <textarea
      ref={ref}
      value={draft}
      placeholder={placeholder}
      rows={1}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // Enter commits + blurs for single-line fields; Shift+Enter always newlines.
        if (e.key === "Enter" && !e.shiftKey && !multiline) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      className={cn(
        "w-full resize-none bg-transparent outline-none placeholder:text-faint field-sizing-content",
        "focus:rounded-md focus:bg-muted/40 focus:px-1.5 focus:py-1 focus:-mx-1.5 focus:-my-1",
        className,
      )}
    />
  );
}
