import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  IconAbc,
  IconChevronDown,
  IconChevronUp,
  IconLetterCase,
  IconX,
} from "@tabler/icons-react";
import { FindOptionToggle } from "@/components/app/find-option-toggle";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { usePdfFindStore } from "@/stores/pdf-find-store";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";

export function PdfFindBar({
  onNext,
  onPrevious,
}: {
  onNext: () => void;
  onPrevious: () => void;
}): ReactNode {
  const open = useSearchSurfaceStore((state) => state.openSurface === "pdf");
  const focusRevision = useSearchSurfaceStore((state) => state.focusRevision);
  const closeSurface = useSearchSurfaceStore((state) => state.close);
  const query = usePdfFindStore((state) => state.query);
  const caseSensitive = usePdfFindStore((state) => state.caseSensitive);
  const wholeWord = usePdfFindStore((state) => state.wholeWord);
  const status = usePdfFindStore((state) => state.status);
  const current = usePdfFindStore((state) => state.current);
  const total = usePdfFindStore((state) => state.total);
  const error = usePdfFindStore((state) => state.error);
  const setQuery = usePdfFindStore((state) => state.setQuery);
  const toggleCase = usePdfFindStore((state) => state.toggleCase);
  const toggleWholeWord = usePdfFindStore((state) => state.toggleWholeWord);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, focusRevision]);

  if (!open) return null;

  const canNavigate =
    status !== "pending" && status !== "error" && total > 0;
  const statusText =
    status === "error"
      ? error
      : status === "not-found"
        ? "No results"
        : total > 0
          ? `${current} of ${total}`
          : null;

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSurface("pdf");
      return;
    }
    if (event.key !== "Enter" || !canNavigate) return;
    event.preventDefault();
    if (event.shiftKey) onPrevious();
    else onNext();
  };

  return (
    <div
      data-find-widget
      className="absolute right-4 top-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-card p-1.5 font-sans shadow-md"
    >
      <InputGroup className="w-72">
        <InputGroupInput
          ref={inputRef}
          value={query}
          aria-label="Find in PDF"
          placeholder="Find"
          aria-invalid={status === "error"}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
        />
        <InputGroupAddon
          align="inline-end"
          className="tabular-nums text-faint"
        >
          {status === "pending" ? (
            <Spinner aria-label="Searching PDF" className="size-3" />
          ) : (
            statusText
          )}
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          <FindOptionToggle
            active={caseSensitive}
            title="Match case"
            onClick={toggleCase}
          >
            <IconLetterCase />
          </FindOptionToggle>
          <FindOptionToggle
            active={wholeWord}
            title="Match whole word"
            onClick={toggleWholeWord}
          >
            <IconAbc />
          </FindOptionToggle>
        </InputGroupAddon>
      </InputGroup>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Previous match (Shift+Enter)"
        aria-label="Previous PDF match"
        disabled={!canNavigate}
        onClick={onPrevious}
      >
        <IconChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Next match (Enter)"
        aria-label="Next PDF match"
        disabled={!canNavigate}
        onClick={onNext}
      >
        <IconChevronDown />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Close (Esc)"
        aria-label="Close PDF find"
        onClick={() => closeSurface("pdf")}
      >
        <IconX />
      </Button>
    </div>
  );
}
