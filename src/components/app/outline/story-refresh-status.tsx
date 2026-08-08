import { CharacterCandidatesDialog } from "@/components/app/outline/character-candidates-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TypographyMuted } from "@/components/ui/typography";
import type { ProjectKnowledge } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";
import { useStoryRefreshStore } from "@/stores/story-refresh-store";

function coverageLabel(
  chapterIds: string[],
  knowledge: ProjectKnowledge,
  latestSavedFingerprints: Record<string, string>,
): string {
  const refreshedChapters = chapterIds.filter((chapterId) => {
    const chapterKnowledge = knowledge.chapters[chapterId];
    if (chapterKnowledge === undefined) return false;
    const latestSavedFingerprint = latestSavedFingerprints[chapterId];
    return (
      latestSavedFingerprint === undefined ||
      chapterKnowledge.sourceFingerprint === latestSavedFingerprint
    );
  }).length;

  if (refreshedChapters === 0) return "Not refreshed";
  if (refreshedChapters === chapterIds.length) return "Up to date";
  return `${refreshedChapters} of ${chapterIds.length} chapters refreshed`;
}

export function StoryRefreshStatus() {
  const project = useProjectStore((state) => state.project);
  const knowledge = useProjectStore((state) => state.meta.knowledge);
  const status = useStoryRefreshStore((state) => state.status);
  const progress = useStoryRefreshStore((state) => state.progress);
  const error = useStoryRefreshStore((state) => state.error);
  const latestSavedFingerprints = useStoryRefreshStore(
    (state) => state.latestSavedFingerprints,
  );
  const retry = useStoryRefreshStore((state) => state.retry);
  const chapterIds = project === null ? [] : project.chapters.map((chapter) => chapter.id);

  return (
    <div className="flex min-h-7 items-center gap-2">
      {status === "refreshing" ? (
        <>
          <Spinner />
          <TypographyMuted>
            Refreshing {progress.completedChapters} of {progress.totalChapters} chapters
          </TypographyMuted>
        </>
      ) : null}
      {status === "failed" ? (
        <>
          <TypographyMuted role="alert" className="text-destructive">
            {error}
          </TypographyMuted>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </>
      ) : null}
      {status === "idle" ? (
        <TypographyMuted>
          {coverageLabel(chapterIds, knowledge, latestSavedFingerprints)}
        </TypographyMuted>
      ) : null}
      <CharacterCandidatesDialog />
    </div>
  );
}
