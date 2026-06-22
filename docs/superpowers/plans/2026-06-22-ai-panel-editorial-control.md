# AI Panel: editorial control + cursor anchoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI panel screen wait for an explicit **Generate** click, let the author steer each request with an optional instruction, and show a persistent "you are here" anchor for the selected block.

**Architecture:** Three layers change. (1) The AI lib (`context.ts`/`operations.ts`/`prompts.ts`) gains an optional `instruction` carried through `AiContext` into the grounding, plus a richer cursor summary. (2) The panel (`ai-panel.tsx`) reworks the `useAi` hook from auto-run to idle-first-with-reset, adds a shared `AskBox` and a `CursorAnchor`, and gives all four generating tabs (Suggest/Critique/Continuity/Cast) an idle→loading→error→data flow. (3) The view store stops using a run-nonce; `triggerSuggest` only opens+focuses.

**Tech Stack:** React 19, TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`), Tailwind 4, zustand, Vercel AI SDK (`gpt-5.4-nano`), Tauri 2, Bun + `just`.

**Spec:** `docs/superpowers/specs/2026-06-22-ai-panel-editorial-control-design.md`

> **Note on commits:** this repo currently has **no commits** and the whole tree is untracked. The commit steps below stage only the files each task changes; if you'd rather make the project's initial commit yourself first, do that and the per-task commits still apply cleanly.

> **Note on testing:** the project has **no test runner** (adding one is out of scope per the spec). Each task is verified with `just typecheck` (must be green) and the final task runs a manual pass in `just run`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/lib/ai/operations.ts` | AI op seam + `AiContext` type + `buildGrounding` | Add `instruction?` to `AiContext`; append `AUTHOR'S REQUEST` block in `buildGrounding` |
| `src/lib/ai/prompts.ts` | System prompts | Add one "honour the author's request" line to the 4 generating prompts |
| `src/lib/ai/context.ts` | Build `AiContext` from editor state | Enrich `cursorSummary` with the end of the last block |
| `src/stores/view-store.ts` | Ephemeral view state | Rename `suggestNonce` → `suggestFocusTick` (focus only, never runs) |
| `src/components/app/ai-panel.tsx` | The assistant panel + tabs | Rework `useAi`; add `CursorAnchor` + `AskBox`; idle-first states for the 4 generating tabs; render anchor in shell |

`block.tsx` and `editor.tsx` need **no changes** — they call `triggerSuggest()`, whose name is unchanged.

---

## Task 1: AI lib — instruction plumbing + richer cursor summary

**Files:**
- Modify: `src/lib/ai/operations.ts` (the `AiContext` interface, `buildGrounding`)
- Modify: `src/lib/ai/prompts.ts` (`SUGGEST_SYSTEM`, `CRITIQUE_SYSTEM`, `CONTINUITY_SYSTEM`, `CAST_SYSTEM`)
- Modify: `src/lib/ai/context.ts` (`cursorSummary`)

- [ ] **Step 1: Add `instruction` to `AiContext`**

In `src/lib/ai/operations.ts`, add the field to the interface (after `characters`):

```ts
  /** The known cast, so the model can name speakers and tag colours. */
  characters?: { name: string; role?: string }[];
  /** Optional free-text steering from the author's ask box; honoured when present. */
  instruction?: string;
```

- [ ] **Step 2: Append the author's request in `buildGrounding`**

In the same file, change the tail of `buildGrounding` (currently the `SCENE PROSE` push + return) to:

```ts
  // The scene itself goes before the request so the request is the last,
  // freshest, most salient directive in the model's window.
  parts.push(`SCENE PROSE:\n${ctx.blocksText}`);

  if (ctx.instruction) {
    parts.push(`AUTHOR'S REQUEST (follow this):\n${ctx.instruction}`);
  }

  return parts.join("\n\n");
```

- [ ] **Step 3: Teach the four generating prompts to honour the request**

In `src/lib/ai/prompts.ts`, append a final paragraph **inside** each template literal, before its closing `` `; ``.

`SUGGEST_SYSTEM` — after the `"followups"` paragraph:

```
If the author included an explicit request ("AUTHOR'S REQUEST"), treat it as the primary brief and shape all three continuations to honour it. Otherwise, use your judgment.
```

`CRITIQUE_SYSTEM` — after the "balanced handful" paragraph:

```
If the author included an explicit request ("AUTHOR'S REQUEST"), focus your notes on what they asked about. Otherwise, cover the most important craft notes you see.
```

`CONTINUITY_SYSTEM` — after the "high-signal observations" paragraph:

```
If the author included an explicit request ("AUTHOR'S REQUEST"), prioritise the continuity dimension they named. Otherwise, sweep broadly.
```

`CAST_SYSTEM` — after the "Do not invent characters" paragraph:

```
If the author included an explicit request ("AUTHOR'S REQUEST"), let it focus your reading. Otherwise, report the full cast you can see.
```

- [ ] **Step 4: Enrich `cursorSummary`**

In `src/lib/ai/context.ts`, replace the `const last = …` / `const cursorSummary = …` block with:

```ts
  const last = upto[upto.length - 1];
  let cursorSummary: string;
  if (!last) {
    cursorSummary = "Cursor is at the start of the chapter.";
  } else {
    // Slicing here is fine — this is a model-facing prompt string, not UI text.
    const tail = last.text.trim().split(/\s+/).slice(-12).join(" ");
    cursorSummary = tail
      ? `Cursor sits just after a ${last.type} block ending: "…${tail}". Continue from exactly there.`
      : `Cursor sits just after a ${last.type} block.`;
  }
```

- [ ] **Step 5: Typecheck**

Run: `just typecheck`
Expected: no errors (exit 0).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/operations.ts src/lib/ai/prompts.ts src/lib/ai/context.ts
git commit -m "feat(ai): carry an optional author instruction into grounding + richer cursor summary"
```

---

## Task 2: AI panel — manual hook, anchor, ask box, idle-first tabs

**Files:**
- Modify: `src/stores/view-store.ts` (rename `suggestNonce` → `suggestFocusTick`)
- Modify: `src/components/app/ai-panel.tsx` (imports, `useAi`, new `CursorAnchor` + `AskBox`, 4 tabs, shell)

> Intermediate steps in this task may not typecheck on their own; the **task boundary** (Step 10) must be green. Do the steps in order.

- [ ] **Step 1: Rename the view-store field to a focus tick**

In `src/stores/view-store.ts`:

In the `ViewState` interface, replace:

```ts
  /** Bumped to ask the Suggest tab to (re)run for the current cursor. */
  suggestNonce: number;
```

with:

```ts
  /** Bumped to focus the Suggest ask box (e.g. from the ✨ spark). Never runs the model. */
  suggestFocusTick: number;
```

In the store body, replace `suggestNonce: 0,` with `suggestFocusTick: 0,`, and replace the `triggerSuggest` implementation with:

```ts
  triggerSuggest: () =>
    set((s) => ({
      aiOpen: true,
      focus: false,
      aiTab: "suggest",
      suggestFocusTick: s.suggestFocusTick + 1,
    })),
```

Also update the doc comment on the `triggerSuggest` interface member to: `/** Open the AI panel, focus Suggest, and put the cursor in the ask box. Does not infer. */`

- [ ] **Step 2: Add the `IconSparkles` import in the panel**

In `src/components/app/ai-panel.tsx`, add `IconSparkles` to the `@tabler/icons-react` import block:

```ts
import {
  IconArrowRight,
  IconLoader2,
  IconRefresh,
  IconSend,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
```

- [ ] **Step 3: Rework `useAi` to idle-first with reset**

Replace the entire `useAi` function with:

```tsx
/** Manual async result: idle until run() is called; clears back to idle when resetKey changes. */
function useAi<T>(op: () => Promise<T>, resetKey: unknown = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opRef = useRef(op);
  opRef.current = op;

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    opRef
      .current()
      .then((d) => setData(d))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Anchor (chapter/cursor) changed → drop stale results back to idle. Never auto-runs.
  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, [resetKey]);

  return { data, loading, error, run };
}
```

- [ ] **Step 4: Add `CursorAnchor` and `AskBox` (after `useAi`, before `SuggestTab`)**

```tsx
/** Persistent "you are here": the block the next AI action anchors to. */
function CursorAnchor() {
  const selectedId = useProjectStore((s) => s.selectedId);
  const blocks = useProjectStore((s) => s.blocks);
  const block = selectedId ? blocks.find((b) => b.id === selectedId) : undefined;
  const text = block?.text.trim();

  return (
    <div className="flex items-center gap-2 border-b border-line-soft bg-ai-tint/40 px-3 py-1.5">
      <span className="shrink-0 font-ui text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ai-ink">
        {block ? `Continuing after · ${block.type}` : "Cursor"}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "line-clamp-1",
            text ? "font-serif text-[11.5px] italic text-mid" : "font-ui text-[11px] text-faint",
          )}
        >
          {text || "Place your cursor in the manuscript."}
        </p>
      </div>
    </div>
  );
}

/** Optional instruction + a Generate button, shared by the four generating tabs. */
function AskBox({
  value,
  onChange,
  onGenerate,
  loading,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onGenerate: () => void;
  loading: boolean;
  placeholder: string;
  inputRef?: React.Ref<HTMLTextAreaElement>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onGenerate();
          }
        }}
        placeholder={placeholder}
        rows={2}
        className="min-h-0 resize-none font-ui text-[12.5px]"
      />
      <Button size="sm" onClick={onGenerate} disabled={loading} className="self-start">
        {loading ? <IconLoader2 className="animate-spin" /> : <IconSparkles />}
        Generate
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Rework `SuggestTab`**

Replace the entire `SuggestTab` function with:

```tsx
function SuggestTab() {
  const focusTick = useViewStore((s) => s.suggestFocusTick);
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const insertAfter = useProjectStore((s) => s.insertAfter);
  const selectedId = useProjectStore((s) => s.selectedId);
  const characters = useProjectStore((s) => s.meta.characters);

  const [instruction, setInstruction] = useState("");
  const askRef = useRef<HTMLTextAreaElement>(null);
  const resetKey = `${activeChapterId ?? ""}:${selectedId ?? ""}`;

  const { data, loading, error, run } = useAi<SuggestResult>(
    () =>
      suggestContinuation({
        ...buildAiContext(),
        instruction: instruction.trim() || undefined,
      }),
    resetKey,
  );

  const [variant, setVariant] = useState(0);
  useEffect(() => setVariant(0), [data]);

  // The ✨ spark / "Suggest from context" lands the cursor in the ask box. No call.
  useEffect(() => {
    askRef.current?.focus();
  }, [focusTick]);

  const insert = (s: Suggestion) => {
    const speakerId =
      s.type === "dialogue" && s.speaker
        ? characters.find((c) => c.name.toLowerCase() === s.speaker?.toLowerCase())?.id
        : undefined;
    insertAfter(selectedId, { type: s.type, text: s.text, speaker: speakerId });
  };

  const v =
    data && data.suggestions.length > 0
      ? data.suggestions[Math.min(variant, data.suggestions.length - 1)]
      : undefined;

  return (
    <div className="flex flex-col gap-3.5 p-4">
      <AskBox
        value={instruction}
        onChange={setInstruction}
        onGenerate={run}
        loading={loading}
        placeholder="Ask for a direction — e.g. more tension, have her lie (optional)"
        inputRef={askRef}
      />

      {loading ? (
        <LoadingLines rows={5} />
      ) : error ? (
        <AiError error={error} onRetry={run} />
      ) : !data ? (
        <p className="font-ui text-xs leading-relaxed text-faint">
          Generate reads the scene up to your cursor and proposes three ways to continue.
        </p>
      ) : !v ? (
        <p className="font-ui text-xs text-faint">No suggestion.</p>
      ) : (
        <>
          <div className="flex flex-col gap-2.5 rounded-xl border border-ai-edge bg-ai-tint p-3">
            <div className="flex items-center justify-between">
              <span className="font-ui text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ai-ink">
                {v.type === "dialogue" ? `Dialogue${v.speaker ? ` · ${v.speaker}` : ""}` : "Narration"}
              </span>
              <div className="flex gap-0.5">
                {data.suggestions.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setVariant(i)}
                    className={cn(
                      "size-[18px] rounded font-ui text-[10.5px] tabular-nums text-ai-ink transition-opacity",
                      i === variant
                        ? "bg-card opacity-100 shadow-[0_0_0_0.5px_var(--ai-edge)]"
                        : "opacity-55 hover:opacity-100",
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
                v.type === "narration" && "italic text-mid",
              )}
            >
              {v.type === "dialogue" ? `“${v.text}”` : v.text}
            </p>
            <div className="flex flex-col gap-0.5 border-t border-ai-edge pt-2">
              <span className="font-ui text-[10px] uppercase tracking-[0.08em] text-ai-ink opacity-70">Why</span>
              <p className="font-ui text-xs leading-[1.5] text-mid">{v.rationale}</p>
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
                <span className="font-ui text-[10px] uppercase tracking-[0.08em] text-faint">
                  After this, you could…
                </span>
                {data.followups.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 font-ui text-xs text-mid"
                  >
                    <IconArrowRight className="size-3 shrink-0 text-faint" />
                    {f}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Rework `CritiqueTab`**

Replace the entire `CritiqueTab` function with:

```tsx
function CritiqueTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const selectedId = useProjectStore((s) => s.selectedId);
  const [instruction, setInstruction] = useState("");
  const resetKey = `${activeChapterId ?? ""}:${selectedId ?? ""}`;
  const { data, loading, error, run } = useAi<CritiqueNote[]>(
    () => critique({ ...buildAiContext(), instruction: instruction.trim() || undefined }),
    resetKey,
  );
  return (
    <div className="flex flex-col gap-3 p-4">
      <AskBox
        value={instruction}
        onChange={setInstruction}
        onGenerate={run}
        loading={loading}
        placeholder="Focus the critique — e.g. pacing, dialogue (optional)"
      />
      {loading ? (
        <LoadingLines rows={6} />
      ) : error ? (
        <AiError error={error} onRetry={run} />
      ) : !data ? (
        <p className="font-ui text-xs leading-relaxed text-faint">
          Generate reads the scene up to your cursor and returns craft notes.
        </p>
      ) : (
        data.map((n, i) => (
          <div key={i} className="rounded-lg border border-line-soft bg-background p-3">
            <div className="mb-1 flex items-baseline gap-2">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 font-ui text-[9.5px] font-semibold uppercase tracking-[0.08em]",
                  NOTE_TONE[n.kind],
                )}
              >
                {NOTE_WORD[n.kind]}
              </span>
              <span className="font-ui text-[10.5px] uppercase tracking-[0.06em] text-mid">{n.tag}</span>
            </div>
            <p className="font-ui text-[12.5px] leading-[1.55] text-mid">{n.text}</p>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 7: Rework `ContinuityTab`**

Replace the entire `ContinuityTab` function with:

```tsx
function ContinuityTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const selectedId = useProjectStore((s) => s.selectedId);
  const [instruction, setInstruction] = useState("");
  const resetKey = `${activeChapterId ?? ""}:${selectedId ?? ""}`;
  const { data, loading, error, run } = useAi<ContinuityFlag[]>(
    () => continuityCheck({ ...buildAiContext(), instruction: instruction.trim() || undefined }),
    resetKey,
  );
  return (
    <div className="flex flex-col gap-3 p-4">
      <AskBox
        value={instruction}
        onChange={setInstruction}
        onGenerate={run}
        loading={loading}
        placeholder="Anything specific to check? (optional)"
      />
      {loading ? (
        <LoadingLines rows={6} />
      ) : error ? (
        <AiError error={error} onRetry={run} />
      ) : !data ? (
        <p className="font-ui text-xs leading-relaxed text-faint">
          Generate sweeps the scene up to your cursor for continuity issues.
        </p>
      ) : (
        data.map((f, i) => (
          <div key={i} className="grid grid-cols-[14px_1fr] gap-2 rounded-lg border border-line-soft p-2.5">
            <span className={cn("mt-1 size-2 rounded-full", SEV_DOT[f.sev])} />
            <div>
              <div className="mb-0.5 flex items-baseline gap-2">
                <span className="font-ui text-[11px] font-semibold text-foreground">{f.tag}</span>
                <span className="font-ui text-[9.5px] uppercase tracking-[0.08em] text-faint">{SEV_WORD[f.sev]}</span>
              </div>
              <p className="font-ui text-xs leading-[1.5] text-mid">{f.text}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 8: Rework `CastTab`**

Replace the entire `CastTab` function with:

```tsx
function CastTab() {
  const activeChapterId = useProjectStore((s) => s.activeChapterId);
  const selectedId = useProjectStore((s) => s.selectedId);
  const [instruction, setInstruction] = useState("");
  const resetKey = `${activeChapterId ?? ""}:${selectedId ?? ""}`;
  const { data, loading, error, run } = useAi(
    () => detectCast({ ...buildAiContext(), instruction: instruction.trim() || undefined }),
    resetKey,
  );
  return (
    <div className="flex flex-col gap-3 p-4">
      <AskBox
        value={instruction}
        onChange={setInstruction}
        onGenerate={run}
        loading={loading}
        placeholder="Anything specific about the cast? (optional)"
      />
      {loading ? (
        <LoadingLines rows={5} />
      ) : error ? (
        <AiError error={error} onRetry={run} />
      ) : !data ? (
        <p className="font-ui text-xs leading-relaxed text-faint">
          Generate reads the scene up to your cursor and lists who's present.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2.5">
            {data.inScene.map((m, i) => (
              <CastRow key={i} m={m} />
            ))}
          </div>
          {data.offPage.length > 0 ? (
            <>
              <Separator />
              <ContextLine>Off-page but referenced</ContextLine>
              <div className="flex flex-col gap-2.5">
                {data.offPage.map((m, i) => (
                  <CastRow key={i} m={m} />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Render `CursorAnchor` in the panel shell**

In `AiPanel`, inside `<Tabs …>`, insert `<CursorAnchor />` immediately **after** the closing `</TabsList>` and **before** the first `<TabsContent …>`:

```tsx
        </TabsList>

        <CursorAnchor />

        {/* Suggest/Critique/etc. own their own scrolling; Brainstorm fills height. */}
        <TabsContent value="suggest" className="min-h-0 flex-1 overflow-y-auto">
```

- [ ] **Step 10: Typecheck**

Run: `just typecheck`
Expected: no errors (exit 0). If it flags an unused symbol, confirm `ContextLine` is still used (CastTab off-page) and `IconRefresh` is still used (`AiError`) — both should remain.

- [ ] **Step 11: Commit**

```bash
git add src/stores/view-store.ts src/components/app/ai-panel.tsx
git commit -m "feat(ai-panel): click-to-generate, per-tab ask box, and a cursor anchor"
```

---

## Task 3: Verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck is green**

Run: `just typecheck`
Expected: exit 0, no output errors.

- [ ] **Step 2: Manual pass in the desktop app**

Run: `just run` (boots Vite + the native window with hot reload). Confirm each:

1. **No auto-inference:** open the AI panel and click through Suggest / Critique / Continuity / Cast — **no** model call fires, each shows its ask box + idle hint. (Watch the network tab / no loading skeleton appears until you click Generate.)
2. **Generate works:** type nothing, click **Generate** on Suggest → three continuations appear. Click **Generate** on the other three tabs → their results appear.
3. **Editorial control:** on Suggest, type an instruction (e.g. "make it darker, end on a question"), click **Generate**, confirm the output visibly reflects the ask.
4. **Anchor tracks the cursor:** click different blocks in the editor; the strip under the tab bar updates to "Continuing after · <type>" + the first words of that block; with nothing selected it reads "Place your cursor in the manuscript."
5. **Clear-to-idle:** Generate a suggestion, then click a different block — the Suggest results clear back to the idle hint (no auto refetch). Same when switching chapters.
6. **Spark focus:** click a block's ✨ spark (or the editor's "Suggest from context") — the panel opens on Suggest with the cursor in the ask box, and **no** call fires until you click Generate.
7. **Cmd/Ctrl+Enter** in an ask box triggers Generate.

- [ ] **Step 3: Note any deviations**

If any check fails, fix in the relevant file, re-run `just typecheck`, and amend the appropriate task's commit. If all pass, no commit is needed.

---

## Self-Review (completed during authoring)

**Spec coverage:**
- "Kill auto-inference (all screens)" → Task 2 Steps 3, 5–8 (idle-first `useAi`, no mount run) + Step 1 (`triggerSuggest` no longer bumps a run-nonce). ✓
- "You are here anchor" → Task 2 Steps 4, 9 (`CursorAnchor` + shell render). ✓
- "Ask box on all four generating tabs" → Task 2 Steps 4–8 (`AskBox` + wiring). ✓
- "Instruction plumbing + prompts + cursorSummary" → Task 1. ✓
- "Clear-to-idle on anchor change" → Task 2 Step 3 (`resetKey` effect) + per-tab `resetKey`. ✓
- "Generate label / optional instruction / Cmd-Enter" → Task 2 Step 4 (`AskBox`). ✓
- "Block-level cursor, no caret" → honoured throughout (resetKey/anchor use `selectedId`). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `instruction?: string` defined in Task 1 Step 1 and consumed via `{ ...buildAiContext(), instruction: instruction.trim() || undefined }` in all four tabs (Task 2). `suggestFocusTick` defined in Task 2 Step 1, read in Step 5. `useAi(op, resetKey)` signature matches all call sites. `AskBox`/`CursorAnchor` prop shapes match their call sites. ✓
