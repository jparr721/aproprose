// inline-edit.tsx -- an outline field backed by shadcn Input/Textarea.
//
// Holds a local draft so typing is smooth and the store write lands once, on
// blur, only when the value actually changed. This matters: every outline setter
// persists to disk eagerly (project-store persistMeta -> writeProjectMeta with no
// debounce), so a plain controlled input would write to disk on every keystroke.
// Used for every editable outline field (premise, act summary/title, beat
// title/intention, chapter goal/conflict/turn).

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

  // Re-sync when the upstream value changes (e.g. switching chapters).
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (next !== value.trim()) onCommit(next);
  };

  if (multiline) {
    return (
      <Textarea
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={cn("min-h-0", className)}
      />
    );
  }

  return (
    <Input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // Enter commits + blurs single-line fields.
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
}
