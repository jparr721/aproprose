import { CharacterCandidatesDialog } from "@/components/app/outline/character-candidates-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TypographyMuted } from "@/components/ui/typography";
import { openNotifications } from "@/lib/notifications";
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
  const latestSavedFingerprints = useStoryRefreshStore(
    (state) => state.latestSavedFingerprints,
  );
  const chapterIds = project === null ? [] : project.chapters.map((chapter) => chapter.id);

  return (
    <div className="flex min-h-7 items-center gap-2">
      {status === "refreshing" ? (
        <>
          <Spinner />
          <TypographyMuted>
            {progress.totalChapters > 0
              ? `Refreshing ${progress.completedChapters} of ${progress.totalChapters} chapters`
              : "Refreshing story knowledge"}
          </TypographyMuted>
        </>
      ) : null}
      {status === "failed" ? (
        <>
          <TypographyMuted>Story refresh paused</TypographyMuted>
          <Button variant="ghost" size="sm" onClick={openNotifications}>
            View notifications
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
