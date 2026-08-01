import { TypographyP } from "@/components/ui/typography";
import { diffWords } from "@/lib/diff/word-diff";

export function AgentDiffPreview(props: { before: string; after: string }) {
  const { before, after } = props;
  return (
    <TypographyP className="whitespace-pre-wrap">
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
