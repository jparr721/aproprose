// brainstorm-tab.tsx -- a multi-turn chat grounded on the scene, streamed a reply
// per turn. Threads live in brainstorm-store keyed by chapter.

import { useEffect, useState } from "react";
import { IconCheck, IconCopy, IconMessages } from "@tabler/icons-react";
import { Spinner } from "@/components/ui/spinner";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageActions,
  MessageAction,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { useProjectStore } from "@/stores/project-store";
import { useBrainstormStore } from "@/stores/brainstorm-store";
import { useAiActivityStore } from "@/stores/ai-activity-store";
import { buildScopedContext, type ReadScope } from "@/lib/ai/context";
import { describeAiError } from "@/lib/ai/errors";
import { brainstorm } from "@/lib/ai/operations";
import { copyText } from "@/lib/clipboard";
import type { ChatMessage } from "@/lib/types";
import {
  AiComposer,
  AiError,
  PanelEmpty,
  ScopeToggle,
} from "@/components/app/right-panel/shared";

const EMPTY_THREAD: ChatMessage[] = [];

/** One-click copy of a chat reply's markdown source. Reveals on message hover. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <MessageActions className="opacity-0 transition-opacity group-hover:opacity-100">
      <MessageAction
        tooltip={copied ? "Copied" : "Copy"}
        label="Copy reply"
        onClick={() => {
          // copyText handles the WebKitGTK fallback; only flash "copied" when the
          // write actually succeeds, never on a blocked/unavailable clipboard.
          void copyText(text).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
      </MessageAction>
    </MessageActions>
  );
}

export function BrainstormTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const messages = useBrainstormStore((s) =>
    activeChapterId ? s.threads[activeChapterId] ?? EMPTY_THREAD : EMPTY_THREAD,
  );
  const setThread = useBrainstormStore((s) => s.setThread);
  const [scope, setScope] = useState<ReadScope>("cursor");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset only the transient (non-persisted) stream/error state on chapter change;
  // the thread itself is restored from the store for the new chapter.
  useEffect(() => {
    setStreaming(null);
    setError(null);
  }, [activeChapterId]);

  // Stream a reply for a history whose last turn is the user message being answered.
  // Pinned to the chapter it was started for: if the author switches chapters mid
  // stream, the committed reply still lands on the right chapter, but the transient
  // streaming/error display does not leak into the now-visible chapter.
  const streamReply = async (history: ChatMessage[]) => {
    if (!activeChapterId) return;
    const chapterId = activeChapterId;
    const onThisChapter = () =>
      useProjectStore.getState().activeChapterId === chapterId;
    useAiActivityStore.getState().start("brainstorm");
    setStreaming("");
    setError(null);
    let acc = "";
    try {
      const result = await brainstorm(
        history.map(({ role, content }) => ({ role, content })),
        buildScopedContext(scope),
      );
      for await (const delta of result.textStream) {
        acc += delta;
        if (onThisChapter()) setStreaming(acc);
      }
      setThread(chapterId, [...history, { role: "assistant", content: acc }]);
      useAiActivityStore.getState().finish("brainstorm", "done");
    } catch (e) {
      // A failed stream is not a real reply: drop the partial (keeping the user
      // turn so "Try again" works) rather than persisting a truncated answer that
      // reads as a short success after reload. Log unconditionally so a failure
      // that lands after the author switched chapters is still diagnosable; only
      // surface it in-panel while this chapter is the one on screen.
      setThread(chapterId, history);
      console.error("[brainstorm] stream failed for chapter", chapterId, "-", e);
      if (onThisChapter()) setError(describeAiError(e));
      useAiActivityStore.getState().finish("brainstorm", "failed");
    } finally {
      if (onThisChapter()) setStreaming(null);
    }
  };

  const send = (text: string) => {
    if (!activeChapterId || streaming != null) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setThread(activeChapterId, next);
    void streamReply(next);
  };

  // "Try again" re-answers the last user turn, dropping any partial reply after it.
  const retry = () => {
    if (!activeChapterId || streaming != null) return;
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) return;
    const history = messages.slice(0, lastUserIdx + 1);
    setThread(activeChapterId, history);
    void streamReply(history);
  };

  return (
    <div className="flex h-full flex-col">
      {messages.length === 0 && streaming == null && !error ? (
        <PanelEmpty icon={IconMessages} title="Brainstorm the scene">
          Riff on the scene: ask about motivations, plant a thread, pressure-test a beat. The AI
          reads {scope === "cursor" ? "everything up to your cursor" : "the whole chapter"}.
        </PanelEmpty>
      ) : (
        <Conversation>
          <ConversationContent className="gap-4 p-4">
            {messages.map((m, i) => (
              <Message key={i} from={m.role}>
                <MessageContent>
                  {m.role === "assistant" ? (
                    <MessageResponse>{m.content}</MessageResponse>
                  ) : (
                    <span className="whitespace-pre-wrap text-sm leading-[1.55]">
                      {m.content}
                    </span>
                  )}
                </MessageContent>
                {m.role === "assistant" ? <CopyButton text={m.content} /> : null}
              </Message>
            ))}
            {streaming != null ? (
              <Message from="assistant">
                <MessageContent>
                  {streaming === "" ? <Spinner /> : <MessageResponse>{streaming}</MessageResponse>}
                </MessageContent>
              </Message>
            ) : null}
            {error ? <AiError error={error} onRetry={retry} /> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}
      <AiComposer
        placeholder={activeChapterId ? "Ask, riff, push back" : "Open a chapter to brainstorm"}
        loading={streaming != null}
        onSubmit={send}
        anchorMode={scope === "cursor" ? "cursor" : "chapter"}
        toolbar={
          <ScopeToggle
            value={scope}
            options={[
              { id: "cursor", label: "Up to cursor" },
              { id: "chapter", label: "Whole chapter" },
            ]}
            onChange={setScope}
            disabled={streaming != null}
          />
        }
      />
    </div>
  );
}
