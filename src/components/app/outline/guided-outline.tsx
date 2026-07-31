import {
  IconCheck,
  IconListDetails,
  IconMessages,
  IconSparkles,
} from "@tabler/icons-react";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { CharacterChip } from "@/components/app/outline/character-chip";
import { LoreChip } from "@/components/app/outline/lore-chip";
import { BEAT_TYPE_LABEL } from "@/components/app/outline/plot-point-badge";
import { AiError } from "@/components/app/right-panel/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  TypographyEyebrow,
  TypographyMuted,
  TypographySmall,
} from "@/components/ui/typography";
import { buildGuidedOutlineContext } from "@/lib/ai/guided-outline-context";
import { describeAiError, withAiRetry } from "@/lib/ai/errors";
import { guideChapterOutline } from "@/lib/ai/operations";
import {
  ACT_TITLES,
  chapterMatchesGuidedOutlinePlan,
  getChapterOutline,
} from "@/lib/outline/model";
import type {
  Character,
  ChatMessage,
  GuidedOutlinePlan,
  GuidedOutlineSession,
  LoreEntry,
} from "@/lib/types";
import { useOutlineGuideStore } from "@/stores/outline-guide-store";
import { useProjectStore } from "@/stores/project-store";

const EMPTY_SESSION: GuidedOutlineSession = { messages: [], plan: null };

function PlanPreview({
  plan,
  characters,
  lore,
}: {
  plan: GuidedOutlinePlan;
  characters: Character[];
  lore: LoreEntry[];
}) {
  const spine = [
    { label: "Premise", value: plan.premise },
    { label: "Goal", value: plan.goal },
    { label: "Conflict", value: plan.conflict },
    { label: "Turn", value: plan.turn },
  ];
  return (
    <Card>
      <CardHeader>
        <TypographyEyebrow>Chapter plan</TypographyEyebrow>
        <CardTitle className="text-base">{plan.summary}</CardTitle>
        {plan.act || plan.plotPoint ? (
          <CardAction className="flex flex-wrap justify-end gap-1">
            {plan.act ? <Badge variant="outline">{ACT_TITLES[plan.act]}</Badge> : null}
            {plan.plotPoint ? (
              <Badge variant="outline">{BEAT_TYPE_LABEL[plan.plotPoint]}</Badge>
            ) : null}
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {spine.map((field) => (
            <div key={field.label} className="flex flex-col gap-1">
              <TypographyEyebrow>{field.label}</TypographyEyebrow>
              <TypographyMuted className="leading-relaxed text-foreground">
                {field.value || "-"}
              </TypographyMuted>
            </div>
          ))}
        </div>

        {plan.characterIds.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <TypographyEyebrow>Chapter cast</TypographyEyebrow>
            <div className="flex flex-wrap gap-1">
              {plan.characterIds
                .map((id) => characters.find((character) => character.id === id))
                .filter((character): character is Character => Boolean(character))
                .map((character) => (
                  <CharacterChip
                    key={character.id}
                    name={character.name}
                    color={character.color}
                  />
                ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <TypographyEyebrow>Chapter beats</TypographyEyebrow>
          {plan.beats.length === 0 ? (
            <TypographyMuted>No plot beats proposed.</TypographyMuted>
          ) : (
            plan.beats.map((beat, index) => {
              const beatCharacters = beat.characterIds
                .map((id) => characters.find((character) => character.id === id))
                .filter((character): character is Character => Boolean(character));
              const beatLore = beat.loreIds
                .map((id) => lore.find((entry) => entry.id === id))
                .filter((entry): entry is LoreEntry => Boolean(entry));
              return (
                <Card key={`${beat.sourceCardId ?? "new"}-${index}`} size="sm">
                  <CardHeader>
                    <TypographyEyebrow>Beat {index + 1}</TypographyEyebrow>
                    <CardTitle>{beat.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    <TypographyMuted className="leading-relaxed">
                      {beat.intention}
                    </TypographyMuted>
                    {beatCharacters.length > 0 || beatLore.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {beatCharacters.map((character) => (
                          <CharacterChip
                            key={character.id}
                            name={character.name}
                            color={character.color}
                          />
                        ))}
                        {beatLore.map((entry) => (
                          <LoreChip key={entry.id} title={entry.title} />
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function GuidedOutline({ chapterId }: { chapterId: string }) {
  const session = useOutlineGuideStore((state) => (
    state.sessions[chapterId] ?? EMPTY_SESSION
  ));
  const running = useOutlineGuideStore((state) => state.running[chapterId] === true);
  const error = useOutlineGuideStore((state) => state.errors[chapterId] ?? null);
  const characters = useProjectStore((state) => state.meta.characters);
  const lore = useProjectStore((state) => state.meta.lore);
  const chapter = useProjectStore((state) => getChapterOutline(state.meta.chapters, chapterId));
  const applyPlan = useProjectStore((state) => state.applyGuidedOutlinePlan);
  const plan = session.plan;
  const applied = plan !== null
    && chapterMatchesGuidedOutlinePlan(chapter, plan);

  const requestTurn = (history: ChatMessage[]) => {
    if (useOutlineGuideStore.getState().running[chapterId] === true) return;
    const project = useProjectStore.getState().project;
    if (project === null) {
      return;
    }
    const projectRoot = project.root;
    const currentPlan = useOutlineGuideStore.getState().sessions[chapterId]?.plan ?? null;
    const context = buildGuidedOutlineContext(chapterId);
    const turnId = useOutlineGuideStore.getState().startTurn(chapterId, history);
    void withAiRetry(() => guideChapterOutline(history, context, currentPlan))
      .then((turn) => {
        if (useProjectStore.getState().project?.root !== projectRoot) return;
        const latestPlan = useOutlineGuideStore.getState().sessions[chapterId]?.plan ?? currentPlan;
        useOutlineGuideStore.getState().finishTurn(chapterId, turnId, {
          messages: [...history, { role: "assistant", content: turn.reply }],
          plan: turn.plan ?? latestPlan,
        });
      })
      .catch((cause: unknown) => {
        if (useProjectStore.getState().project?.root !== projectRoot) return;
        useOutlineGuideStore.getState().failTurn(chapterId, turnId, describeAiError(cause));
      });
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    requestTurn([...session.messages, { role: "user", content: trimmed }]);
  };

  return (
    <div className="@container h-full min-h-0 overflow-y-auto">
      <div className="grid min-h-full grid-cols-1 @min-[52rem]:h-full @min-[52rem]:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)]">
        <section className="flex min-h-[34rem] flex-col @min-[52rem]:min-h-0">
          <Conversation>
            <ConversationContent className="gap-4 p-4">
              {session.messages.length === 0 && !running && error === null ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon" className="size-12 rounded-xl bg-ai-tint text-ai-ink">
                      <IconMessages className="size-6" />
                    </EmptyMedia>
                    <EmptyTitle className="text-base">Talk the chapter through</EmptyTitle>
                    <EmptyDescription className="text-sm">
                      Start anywhere. Dictate what you know, what feels uncertain, or the ending
                      you want. The guide asks one focused question at a time and assembles the
                      answers into a chapter plan.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
              {session.messages.map((message, index) => (
                <Message key={index} from={message.role}>
                  <MessageContent>
                    {message.role === "assistant" ? (
                      <MessageResponse>{message.content}</MessageResponse>
                    ) : (
                      <TypographySmall className="whitespace-pre-wrap leading-relaxed">
                        {message.content}
                      </TypographySmall>
                    )}
                  </MessageContent>
                </Message>
              ))}
              {running ? (
                <Message from="assistant">
                  <MessageContent>
                    <Spinner />
                  </MessageContent>
                </Message>
              ) : null}
              {error ? (
                <AiError error={error} onRetry={() => requestTurn(session.messages)} />
              ) : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-card p-3">
            <PromptInput
              onSubmit={(message) => {
                send(message.text);
              }}
            >
              <PromptInputBody>
                <PromptInputTextarea
                  placeholder="Talk through the chapter or answer the question"
                  disabled={running}
                />
              </PromptInputBody>
              <PromptInputFooter className="justify-between">
                {session.messages.length > 0 && session.plan === null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={running}
                    onClick={() => send("Show me the chapter plan we have arrived at.")}
                  >
                    <IconListDetails /> Build preview
                  </Button>
                ) : (
                  <span />
                )}
                <PromptInputSubmit
                  status={running ? "submitted" : undefined}
                  disabled={running}
                  size="sm"
                >
                  {running ? <Spinner /> : <IconSparkles />}
                </PromptInputSubmit>
              </PromptInputFooter>
            </PromptInput>
          </div>
        </section>

        <section className="flex min-h-[28rem] flex-col border-t border-border bg-muted/20 @min-[52rem]:min-h-0 @min-[52rem]:border-l @min-[52rem]:border-t-0">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {plan ? (
              <PlanPreview plan={plan} characters={characters} lore={lore} />
            ) : (
              <Empty className="h-full border-none">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconListDetails />
                  </EmptyMedia>
                  <EmptyTitle>The plan will appear here</EmptyTitle>
                  <EmptyDescription>
                    As the chapter takes shape, the guide collects its spine, cast, and ordered
                    beats into a preview you can review before anything changes.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
          {plan ? (
            <div className="border-t border-border bg-background p-3">
              <Button
                className="w-full"
                disabled={applied}
                variant={applied ? "outline" : "default"}
                onClick={() => {
                  applyPlan(chapterId, plan);
                  toast.success("Chapter plan applied");
                }}
              >
                {applied ? <IconCheck /> : <IconSparkles />}
                {applied ? "Applied" : "Apply plan"}
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
