// ai-panel.tsx — the right-side assistant. Five tabs, each backed by a real
// gpt-5.4-nano call grounded on the current scene:
//   Suggest · Critique · Brainstorm · Continuity · Cast
// Each result is fetched once per scene and cached (see useAi / ai-cache-store),
// so remounting a tab reuses it; "Try again" / "Refresh" force a new call.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconArrowRight,
  IconRefresh,
  IconSend,
} from "@tabler/icons-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { ColorAvatar } from "@/components/app/color-dot";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore, type AiTab } from "@/stores/view-store";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { buildAiContext } from "@/lib/ai/context";
import { uid } from "@/lib/id";
import {
  brainstorm,
  critique,
  continuityCheck,
  detectCast,
  suggestContinuation,
} from "@/lib/ai/operations";
import type {
  CastMember,
  ChatMessage,
  CritiqueNote,
  ContinuityFlag,
  SuggestResult,
  Suggestion,
} from "@/lib/types";
import { cn } from "@/lib/utils";

// ── shared bits ──────────────────────────────────────────────────────────────
function ContextLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 font-sans text-[11px] text-muted-foreground">
      <span className="size-1.5 rounded-full bg-ai-edge shadow-[0_0_0_2px_var(--ai-tint)]" />
      {children}
    </div>
  );
}

function AiError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-3 font-sans text-xs text-muted-foreground">
      <span className="text-destructive">Couldn't reach the model.</span>
      <span className="text-faint">{error}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <IconRefresh /> Try again
      </Button>
    </div>
  );
}

function LoadingLines({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full last:w-2/3" />
      ))}
    </div>
  );
}

/** Cached async result. Fetches once the first time a `cacheKey` is seen, then
 *  reuses the stored result across remounts (tab switches, panel/focus toggles,
 *  reopening the panel) so we don't re-burn tokens on a result we already have.
 *  A new key (different scene / bumped suggest nonce) fetches fresh; run() forces
 *  a refetch — that's the tabs' "Try again" / "Refresh" buttons. */
function useAi<T>(op: () => Promise<T>, cacheKey: string) {
  const entry = useAiCacheStore((s) => s.entries[cacheKey]);
  const patch = useAiCacheStore((s) => s.patch);
  const opRef = useRef(op);
  opRef.current = op;

  const run = useCallback(() => {
    patch(cacheKey, { loading: true, error: null });
    opRef
      .current()
      .then((d) => patch(cacheKey, { data: d, loading: false, error: null }))
      .catch((e) => patch(cacheKey, { loading: false, error: String(e) }));
  }, [cacheKey, patch]);

  useEffect(() => {
    // Only the first sighting of a key fetches; read fresh state (not the
    // subscribed `entry`) so a rapid key change can't fire a duplicate request.
    if (useAiCacheStore.getState().entries[cacheKey] === undefined) run();
  }, [cacheKey, run]);

  return {
    data: (entry?.data ?? null) as T | null,
    loading: entry?.loading ?? true,
    error: entry?.error ?? null,
    run,
  };
}

// ── Suggest ────────────────────────────────────────────────────────────────────
function SuggestTab() {
  const nonce = useViewStore((s) => s.suggestNonce);
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const insertAfter = useProjectStore((s) => s.insertAfter);
  const selectedId = useProjectStore((s) => s.selectedId);
  const characters = useProjectStore((s) => s.meta.characters);

  // Refetch when the cursor moves (nonce) OR the chapter changes, so an "Insert
  // below" never drops an old chapter's suggestion into a different scene.
  const { data, loading, error, run } = useAi<SuggestResult>(
    () => suggestContinuation(buildAiContext()),
    `suggest:${activeChapterId ?? ""}:${nonce}`,
  );
  const [variant, setVariant] = useState(0);
  useEffect(() => setVariant(0), [data]);

  const insert = (s: Suggestion) => {
    const speakerId =
      s.type === "dialogue" && s.speaker
        ? characters.find(
            (c) => c.name.toLowerCase() === s.speaker?.toLowerCase(),
          )?.id
        : undefined;
    insertAfter(selectedId, {
      type: s.type,
      text: s.text,
      speaker: speakerId,
    });
  };

  if (loading) return <div className="p-4"><LoadingLines rows={5} /></div>;
  if (error) return <div className="p-4"><AiError error={error} onRetry={run} /></div>;
  if (!data || data.suggestions.length === 0)
    return <div className="p-4 font-sans text-xs text-faint">No suggestion.</div>;

  const v = data.suggestions[Math.min(variant, data.suggestions.length - 1)];

  return (
    <div className="flex flex-col gap-3.5 p-4">
      <ContextLine>Reading the scene up to the cursor</ContextLine>

      <div className="flex flex-col gap-2.5 rounded-xl border border-ai-edge bg-ai-tint p-3">
        <div className="flex items-center justify-between">
          <span className="font-sans text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ai-ink">
            {v.type === "dialogue" ? `Dialogue${v.speaker ? ` · ${v.speaker}` : ""}` : "Narration"}
          </span>
          <div className="flex gap-0.5">
            {data.suggestions.map((_, i) => (
              <button
                key={i}
                onClick={() => setVariant(i)}
                className={cn(
                  "size-[18px] rounded font-sans text-[10.5px] tabular-nums text-ai-ink transition-opacity",
                  i === variant ? "bg-card opacity-100 shadow-[0_0_0_0.5px_var(--ai-edge)]" : "opacity-55 hover:opacity-100",
                )}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
        <p
          className={cn(
            "font-serif text-[14.5px] leading-[1.55] text-foreground",
            v.type === "narration" && "italic text-muted-foreground",
          )}
        >
          {v.type === "dialogue" ? `“${v.text}”` : v.text}
        </p>
        <div className="flex flex-col gap-0.5 border-t border-ai-edge pt-2">
          <span className="font-sans text-[10px] uppercase tracking-[0.08em] text-ai-ink opacity-70">Why</span>
          <p className="font-sans text-xs leading-[1.5] text-muted-foreground">{v.rationale}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => insert(v)}>Insert below</Button>
          <Button size="sm" variant="outline" onClick={run}>Try again</Button>
        </div>
      </div>

      {data.followups.length > 0 ? (
        <>
          <Separator />
          <div className="flex flex-col gap-1">
            <span className="font-sans text-[10px] uppercase tracking-[0.08em] text-faint">
              After this, you could…
            </span>
            {data.followups.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 font-sans text-xs text-muted-foreground"
              >
                <IconArrowRight className="size-3 shrink-0 text-faint" />
                {f}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Critique ─────────────────────────────────────────────────────────────────
const NOTE_TONE: Record<CritiqueNote["kind"], string> = {
  strength: "bg-success/15 text-success",
  watch: "bg-warning/15 text-warning",
  idea: "bg-ai-tint text-ai-ink",
};
const NOTE_WORD: Record<CritiqueNote["kind"], string> = {
  strength: "Working",
  watch: "Watch",
  idea: "Idea",
};

function CritiqueTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const { data, loading, error, run } = useAi<CritiqueNote[]>(
    () => critique(buildAiContext()),
    `critique:${activeChapterId ?? ""}`,
  );
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <ContextLine>Critique of the current scene</ContextLine>
        <Button variant="ghost" size="icon-sm" onClick={run} title="Refresh">
          <IconRefresh />
        </Button>
      </div>
      {loading ? (
        <LoadingLines rows={6} />
      ) : error ? (
        <AiError error={error} onRetry={run} />
      ) : (
        (data ?? []).map((n, i) => (
          <div key={i} className="rounded-lg border border-border bg-background p-3">
            <div className="mb-1 flex items-baseline gap-2">
              <span className={cn("rounded px-1.5 py-0.5 font-sans text-[9.5px] font-semibold uppercase tracking-[0.08em]", NOTE_TONE[n.kind])}>
                {NOTE_WORD[n.kind]}
              </span>
              <span className="font-sans text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">{n.tag}</span>
            </div>
            <p className="font-sans text-[12.5px] leading-[1.55] text-muted-foreground">{n.text}</p>
          </div>
        ))
      )}
    </div>
  );
}

// ── Continuity ─────────────────────────────────────────────────────────────────
const SEV_DOT: Record<ContinuityFlag["sev"], string> = {
  ok: "bg-success",
  warn: "bg-warning",
  flag: "bg-destructive",
};
const SEV_WORD: Record<ContinuityFlag["sev"], string> = {
  ok: "Clean",
  warn: "Check",
  flag: "Flag",
};

function ContinuityTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const { data, loading, error, run } = useAi<ContinuityFlag[]>(
    () => continuityCheck(buildAiContext()),
    `continuity:${activeChapterId ?? ""}`,
  );
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <ContextLine>Continuity sweep of the scene</ContextLine>
        <Button variant="ghost" size="icon-sm" onClick={run} title="Refresh">
          <IconRefresh />
        </Button>
      </div>
      {loading ? (
        <LoadingLines rows={6} />
      ) : error ? (
        <AiError error={error} onRetry={run} />
      ) : (
        (data ?? []).map((f, i) => (
          <div key={i} className="grid grid-cols-[14px_1fr] gap-2 rounded-lg border border-border p-2.5">
            <span className={cn("mt-1 size-2 rounded-full", SEV_DOT[f.sev])} />
            <div>
              <div className="mb-0.5 flex items-baseline gap-2">
                <span className="font-sans text-[11px] font-semibold text-foreground">{f.tag}</span>
                <span className="font-sans text-[9.5px] uppercase tracking-[0.08em] text-faint">{SEV_WORD[f.sev]}</span>
              </div>
              <p className="font-sans text-xs leading-[1.5] text-muted-foreground">{f.text}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Cast ─────────────────────────────────────────────────────────────────────
function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function CastRow({ m }: { m: CastMember }) {
  return (
    <div className="grid grid-cols-[32px_1fr] items-center gap-2.5">
      {m.color ? (
        <ColorAvatar color={m.color} initials={initials(m.name)} />
      ) : (
        <span className="grid size-8 place-items-center rounded-lg border border-dashed border-border font-heading text-xs text-muted-foreground">
          {initials(m.name)}
        </span>
      )}
      <div>
        <div className="flex items-baseline gap-2 font-sans text-[13px] font-medium text-foreground">
          <span className="truncate">{m.name}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.06em] text-muted-foreground">
            {m.state}
          </span>
        </div>
        <div className="font-sans text-[11.5px] leading-[1.45] text-muted-foreground">{m.detail}</div>
      </div>
    </div>
  );
}

function CastTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const { data, loading, error, run } = useAi(
    () => detectCast(buildAiContext()),
    `cast:${activeChapterId ?? ""}`,
  );
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <ContextLine>Who's in the scene</ContextLine>
        <Button variant="ghost" size="icon-sm" onClick={run} title="Refresh">
          <IconRefresh />
        </Button>
      </div>
      {loading ? (
        <LoadingLines rows={5} />
      ) : error ? (
        <AiError error={error} onRetry={run} />
      ) : (
        <>
          <div className="flex flex-col gap-2.5">
            {(data?.inScene ?? []).map((m, i) => <CastRow key={i} m={m} />)}
          </div>
          {data && data.offPage.length > 0 ? (
            <>
              <Separator />
              <ContextLine>Off-page but referenced</ContextLine>
              <div className="flex flex-col gap-2.5">
                {data.offPage.map((m, i) => <CastRow key={i} m={m} />)}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

// ── Brainstorm ─────────────────────────────────────────────────────────────────
type ChatMsg = ChatMessage & { id: string };

function BrainstormTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  // A brainstorm thread belongs to its scene — reset it when the chapter changes
  // so we never carry one chapter's conversation into another.
  useEffect(() => {
    setMessages([]);
    setStreaming(null);
    setError(null);
    setDraft("");
  }, [activeChapterId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming != null) return;
    const next: ChatMsg[] = [...messages, { id: uid("m"), role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setStreaming("");
    setError(null);
    try {
      const result = await brainstorm(
        next.map(({ role, content }) => ({ role, content })),
        buildAiContext(),
      );
      let acc = "";
      for await (const delta of result.textStream) {
        acc += delta;
        setStreaming(acc);
      }
      setMessages([...next, { id: uid("m"), role: "assistant", content: acc }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setStreaming(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-4">
          {messages.length === 0 && streaming == null ? (
            <p className="font-sans text-xs leading-relaxed text-faint">
              Riff on the scene — ask about motivations, plant a thread, pressure-test a
              beat. The AI reads everything up to your cursor.
            </p>
          ) : null}
          {messages.map((m) =>
            m.role === "user" ? (
              <p
                key={m.id}
                className="ml-auto max-w-[88%] rounded-[12px_12px_4px_12px] bg-muted px-3 py-2 font-sans text-[12.5px] leading-[1.55] text-foreground"
              >
                {m.content}
              </p>
            ) : (
              <p
                key={m.id}
                className="max-w-[95%] whitespace-pre-wrap border-l-2 border-ai-edge py-1 pl-3.5 font-sans text-[12.5px] leading-[1.55] text-foreground"
              >
                {m.content}
              </p>
            ),
          )}
          {streaming != null ? (
            <p className="max-w-[95%] whitespace-pre-wrap border-l-2 border-ai-edge py-1 pl-3.5 font-sans text-[12.5px] leading-[1.55] text-foreground">
              {streaming}
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-blink bg-ai-ink align-[-1px]" />
            </p>
          ) : null}
          {error ? <AiError error={error} onRetry={send} /> : null}
        </div>
      </div>
      <div className="flex items-end gap-2 border-t border-border bg-card p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask, riff, push back…"
          rows={2}
          className="min-h-0 resize-none font-sans text-[12.5px]"
        />
        <Button size="icon" onClick={() => void send()} disabled={streaming != null || !draft.trim()}>
          {streaming != null ? <Spinner /> : <IconSend />}
        </Button>
      </div>
    </div>
  );
}

// ── Panel shell ────────────────────────────────────────────────────────────────
const TABS: { id: AiTab; label: string }[] = [
  { id: "suggest", label: "Suggest" },
  { id: "critique", label: "Critique" },
  { id: "brainstorm", label: "Brainstorm" },
  { id: "continuity", label: "Continuity" },
  { id: "cast", label: "Cast" },
];

export function AiPanel() {
  const tab = useViewStore((s) => s.aiTab);
  const setTab = useViewStore((s) => s.setAiTab);

  return (
    <aside
      data-ai-root
      className="flex h-full min-h-0 flex-col border-l border-border bg-card font-sans"
    >
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as AiTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList className="h-auto w-full justify-start gap-0 rounded-none border-b border-border bg-transparent px-2 pt-1.5">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className="rounded-none border-0 border-b-[1.5px] border-transparent bg-transparent px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Suggest/Critique/etc. own their own scrolling; Brainstorm fills height. */}
        <TabsContent value="suggest" className="min-h-0 flex-1 overflow-y-auto">
          <SuggestTab />
        </TabsContent>
        <TabsContent value="critique" className="min-h-0 flex-1 overflow-y-auto">
          <CritiqueTab />
        </TabsContent>
        <TabsContent value="brainstorm" className="min-h-0 flex-1">
          <BrainstormTab />
        </TabsContent>
        <TabsContent value="continuity" className="min-h-0 flex-1 overflow-y-auto">
          <ContinuityTab />
        </TabsContent>
        <TabsContent value="cast" className="min-h-0 flex-1 overflow-y-auto">
          <CastTab />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
