import { TypographyP } from "@/components/ui/typography";
import { diffWords } from "@/lib/diff/word-diff";
import { cn } from "@/lib/utils";

export function AgentDiffPreview(props: {
  before: string;
  after: string;
  /** The surrounding surface's body type, so the diff reads at the same size
   *  and leading as the prose it is previewing. */
  className: string | undefined;
}) {
  const { before, after, className } = props;
  // A diff is a standalone preview block inside a gap-spaced card, never a
  // paragraph in flowing copy, so drop TypographyP's prose top margin — it
  // otherwise doubles up with the card's gap wherever a label precedes it.
  return (
    <TypographyP
      className={cn(
        "whitespace-pre-wrap [&:not(:first-child)]:mt-0",
        className,
      )}
    >
      {diffWords(before, after).map((segment, index) => {
        if (segment.type === "add") {
          return (
            <ins
              className="bg-success/10 no-underline"
              key={`${segment.type}-${index}`}
            >
              {segment.text}
            </ins>
          );
        }
        if (segment.type === "del") {
          return (
            <del
              className="bg-destructive/10 text-destructive"
              key={`${segment.type}-${index}`}
            >
              {segment.text}
            </del>
          );
        }
        return <span key={`${segment.type}-${index}`}>{segment.text}</span>;
      })}
    </TypographyP>
  );
}
