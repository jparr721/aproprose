# Carve & Split Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the writer split a block at the caret and carve a highlighted sub-slice into a new-typed block, via a floating selection toolbar and a keyboard shortcut.

**Architecture:** All cutting is one pure function family in `src/lib/blocks/carve.ts` (Block in → Block[] out), wrapped by two zustand store actions. A single `SelectionToolbar` reads the focused `[data-prose-body]` textarea's selection, measures it with a mirror-div (`textarea-caret.ts`), and calls the actions. Keyboard shortcuts move to one registry (`keybindings.ts`) that also feeds the Settings list and a Compile-button hint; saving now also rebuilds the PDF.

**Tech Stack:** React 19, zustand, Tailwind 4, shadcn primitives (`Button`, `Kbd`/`KbdGroup`), `@tabler/icons-react`, Vitest (new), Bun.

**Spec:** `docs/superpowers/specs/2026-06-22-block-carve-split-design.md`

**Before you start:** other agents are editing this repo concurrently, and the working branch is `master`. Create a feature branch first (e.g. `git switch -c feat/block-carve-split`) and expect unrelated files to change around you — keep edits scoped to the files each task names. Each task ends in a commit.

---

## Task 1: Vitest test harness

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts), `justfile`

- [ ] **Step 1: Install Vitest**

Run: `bun add -D vitest`
Expected: `vitest` appears under `devDependencies` in `package.json`.

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts` (separate from `vite.config.ts` to avoid the Tauri/Tailwind plugin chain and reduce merge churn). It re-declares the `@` alias so tests resolve `@/...` imports.

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

- [ ] **Step 3: Add test scripts to `package.json`**

Add two scripts to the `"scripts"` block (leave the others untouched):

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: Add a `just test` recipe**

Append to `justfile` (match the existing `bun x` style):

```make
# Run the frontend unit tests.
test:
    bun x vitest run
```

- [ ] **Step 5: Verify the runner is installed**

Run: `bun x vitest --version`
Expected: prints a version number (e.g. `3.x.x`), exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock vitest.config.ts justfile
git commit -m "chore: add vitest harness"
```

---

## Task 2: Pure carve logic (`carve.ts`)

**Files:**
- Create: `src/lib/blocks/carve.ts`
- Test: `src/lib/blocks/carve.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/blocks/carve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planSplit, planCarve, stripOuterQuotes } from "@/lib/blocks/carve";
import type { Block } from "@/lib/types";

const mk = (p: Partial<Block> = {}): Block => ({
  id: "src",
  type: "narration",
  text: "",
  raw: "orig",
  dirty: false,
  ...p,
});

describe("planSplit", () => {
  it("is a no-op at the very start or end", () => {
    const b = mk({ text: "Hello world" });
    expect(planSplit(b, 0).blocks).toEqual([b]);
    expect(planSplit(b, 11).blocks).toEqual([b]);
    expect(planSplit(b, 0).focusId).toBe("src");
  });

  it("splits narration into two fresh, dirty pieces at the caret", () => {
    const b = mk({ text: "Hello world" });
    const { blocks, focusId } = planSplit(b, 5);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("Hello");
    expect(blocks[1].text).toBe("world");
    expect(blocks.every((p) => p.type === "narration")).toBe(true);
    expect(blocks.every((p) => p.dirty && p.raw === "")).toBe(true);
    expect(blocks[0].id).not.toBe(blocks[1].id);
    expect(focusId).toBe(blocks[1].id);
  });

  it("keeps the speaker on both halves and moves the beat to the trailing half", () => {
    const b = mk({ type: "dialogue", text: "Hi there", speaker: "c1", beat: "She waved." });
    const { blocks } = planSplit(b, 2);
    expect(blocks[0]).toMatchObject({ type: "dialogue", text: "Hi", speaker: "c1" });
    expect(blocks[0].beat).toBeUndefined();
    expect(blocks[1]).toMatchObject({
      type: "dialogue",
      text: "there",
      speaker: "c1",
      beat: "She waved.",
    });
  });
});

describe("planCarve", () => {
  it("carves a middle slice into a new-typed block, splitting into three", () => {
    const b = mk({ text: "abc def ghi" });
    const { blocks, focusId } = planCarve(b, 4, 7, "lore");
    expect(blocks.map((p) => [p.type, p.text])).toEqual([
      ["narration", "abc"],
      ["lore", "def"],
      ["narration", "ghi"],
    ]);
    expect(focusId).toBe(blocks[1].id);
  });

  it("drops empty edge pieces when the selection touches a boundary", () => {
    const b = mk({ text: "def ghi" });
    const { blocks } = planCarve(b, 0, 3, "lore");
    expect(blocks.map((p) => [p.type, p.text])).toEqual([
      ["lore", "def"],
      ["narration", "ghi"],
    ]);
  });

  it("becomes a whole-block type change when the whole text is selected", () => {
    const b = mk({ text: "all of it" });
    const { blocks } = planCarve(b, 0, 9, "scratchpad");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "scratchpad", text: "all of it" });
    expect(blocks[0].id).not.toBe("src");
  });

  it("strips surrounding quotes when converting to dialogue", () => {
    const b = mk({ text: 'She said, "Run now."' });
    const { blocks } = planCarve(b, 10, 20, "dialogue");
    expect(blocks.map((p) => [p.type, p.text])).toEqual([
      ["narration", "She said,"],
      ["dialogue", "Run now."],
    ]);
    expect(blocks[1].speaker).toBeUndefined();
  });

  it("resets fields converting to a different type, keeps them when isolating", () => {
    const b = mk({ type: "dialogue", text: "Hello there friend", speaker: "c1" });
    const lore = planCarve(b, 6, 11, "lore").blocks;
    expect(lore.map((p) => [p.type, p.speaker])).toEqual([
      ["dialogue", "c1"],
      ["lore", undefined],
      ["dialogue", "c1"],
    ]);
    const iso = planCarve(b, 6, 11, "dialogue").blocks;
    expect(iso[1]).toMatchObject({ type: "dialogue", text: "there", speaker: "c1" });
  });

  it("rebalances emphasis markers across a cut", () => {
    const b = mk({ text: "a _bc_ d" });
    const { blocks } = planSplit(b, 4);
    expect(blocks[0].text).toBe("a _b_");
    expect(blocks[1].text).toBe("_c_ d");
  });
});

describe("stripOuterQuotes", () => {
  it("removes one matched pair of straight or curly quotes", () => {
    expect(stripOuterQuotes('"hi"')).toBe("hi");
    expect(stripOuterQuotes("“hi”")).toBe("hi");
    expect(stripOuterQuotes("'hi'")).toBe("hi");
    expect(stripOuterQuotes("no quotes")).toBe("no quotes");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun x vitest run src/lib/blocks/carve.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/blocks/carve"` (module doesn't exist yet).

- [ ] **Step 3: Implement `carve.ts`**

Create `src/lib/blocks/carve.ts`:

```ts
// carve.ts — pure block-splitting logic shared by the split/convert editor moves.
//
// Both moves cut a block's `text` at offsets and reflow into new blocks:
//   planSplit  — cut at a caret → 2 pieces, same type.
//   planCarve  — cut a selection out → up to 3 pieces, middle re-typed.
// Pure: Block in, plan out. No store, no DOM. Tested in carve.test.ts.

import type { Block, BlockType } from "@/lib/types";
import { uid } from "@/lib/id";

export interface CarvePlan {
  /** The blocks that replace the source block, in order. */
  blocks: Block[];
  /** The id of the piece the editor should select afterward. */
  focusId: string;
}

// One leading + one trailing quote pair is stripped from dialogue bodies, since
// the serializer renders dialogue's own quotes (`` ``…'' ``).
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["“", "”"], // “ ”
  ["'", "'"],
  ["‘", "’"], // ‘ ’
];

export function stripOuterQuotes(text: string): string {
  const t = text.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (t.length >= open.length + close.length && t.startsWith(open) && t.endsWith(close)) {
      return t.slice(open.length, t.length - close.length).trim();
    }
  }
  return t;
}

// True when an `_emphasis_` run is open just before `index` (odd marker count).
function emphasisOpenAt(text: string, index: number): boolean {
  let count = 0;
  const stop = Math.min(index, text.length);
  for (let i = 0; i < stop; i++) {
    if (text[i] === "_") count++;
  }
  return count % 2 === 1;
}

// Close/reopen `_emphasis_` so a piece sliced from `full` over [a, b) never emits
// a dangling marker. Whitespace trimming doesn't affect marker parity.
function balanceEmphasis(piece: string, full: string, a: number, b: number): string {
  let out = piece;
  if (emphasisOpenAt(full, a)) out = `_${out}`;
  if (emphasisOpenAt(full, b)) out = `${out}_`;
  return out;
}

// A fresh replacement piece. `keepTypeFields` carries the source's type-specific
// fields (speaker/level) onto same-type pieces; beat/title are placed by callers.
function makePiece(source: Block, text: string, type: BlockType, keepTypeFields: boolean): Block {
  const piece: Block = { id: uid(), type, text, raw: "", dirty: true };
  if (keepTypeFields) {
    if (source.speaker !== undefined) piece.speaker = source.speaker;
    if (source.level !== undefined) piece.level = source.level;
  }
  return piece;
}

export function planSplit(block: Block, at: number): CarvePlan {
  const text = block.text;
  if (at <= 0 || at >= text.length) return { blocks: [block], focusId: block.id };

  const before = makePiece(
    block,
    balanceEmphasis(text.slice(0, at).replace(/\s+$/, ""), text, 0, at),
    block.type,
    true,
  );
  const after = makePiece(
    block,
    balanceEmphasis(text.slice(at).replace(/^\s+/, ""), text, at, text.length),
    block.type,
    true,
  );

  // Dialogue: the action beat belongs to the trailing utterance.
  if (block.type === "dialogue" && block.beat !== undefined) after.beat = block.beat;
  // Lore: the title belongs to the first piece only.
  if (block.type === "lore" && block.title !== undefined) before.title = block.title;

  return { blocks: [before, after], focusId: after.id };
}

export function planCarve(block: Block, start: number, end: number, newType: BlockType): CarvePlan {
  const text = block.text;
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(text.length, Math.max(start, end));

  // Empty selection behaves like a caret split (newType is irrelevant).
  if (a === b) return planSplit(block, a);

  const sameType = newType === block.type;
  const pieces: Block[] = [];

  const beforeText = balanceEmphasis(text.slice(0, a).replace(/\s+$/, ""), text, 0, a);
  if (beforeText.length > 0) pieces.push(makePiece(block, beforeText, block.type, true));

  let midText = balanceEmphasis(text.slice(a, b).trim(), text, a, b);
  if (newType === "dialogue") midText = stripOuterQuotes(midText);
  const mid = makePiece(block, midText, newType, sameType);
  pieces.push(mid);

  const afterText = balanceEmphasis(text.slice(b).replace(/^\s+/, ""), text, b, text.length);
  if (afterText.length > 0) pieces.push(makePiece(block, afterText, block.type, true));

  // Redistribute the source's type-specific singletons to surviving same-type pieces.
  if (block.type === "dialogue" && block.beat !== undefined) {
    const lastDialogue = [...pieces].reverse().find((p) => p.type === "dialogue");
    if (lastDialogue) lastDialogue.beat = block.beat;
  }
  if (block.type === "lore" && block.title !== undefined) {
    const firstLore = pieces.find((p) => p.type === "lore");
    if (firstLore) firstLore.title = block.title;
  }

  return { blocks: pieces, focusId: mid.id };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun x vitest run src/lib/blocks/carve.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Typecheck**

Run: `just typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/blocks/carve.ts src/lib/blocks/carve.test.ts
git commit -m "feat: pure block split/carve logic"
```

---

## Task 3: Keybindings registry (`keybindings.ts`)

**Files:**
- Create: `src/lib/keybindings.ts`
- Test: `src/lib/keybindings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/keybindings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchesCombo, bindingFor, comboTokens, formatCombo } from "@/lib/keybindings";

const ev = (p: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: "", ...p }) as KeyboardEvent;

describe("matchesCombo", () => {
  it("treats Cmd and Ctrl as the same modifier", () => {
    expect(matchesCombo(ev({ metaKey: true, key: "s" }), { mod: true, key: "s" })).toBe(true);
    expect(matchesCombo(ev({ ctrlKey: true, key: "s" }), { mod: true, key: "s" })).toBe(true);
  });
  it("requires the exact shift state", () => {
    expect(matchesCombo(ev({ metaKey: true, shiftKey: true, key: "z" }), { mod: true, key: "z" })).toBe(false);
    expect(matchesCombo(ev({ metaKey: true, shiftKey: true, key: "z" }), { mod: true, shift: true, key: "z" })).toBe(true);
  });
});

describe("bindingFor", () => {
  it("resolves each shortcut, and null for unbound keys", () => {
    expect(bindingFor(ev({ metaKey: true, key: "s" }))?.id).toBe("save-build");
    expect(bindingFor(ev({ metaKey: true, key: "Enter" }))?.id).toBe("split");
    expect(bindingFor(ev({ metaKey: true, key: "z" }))?.id).toBe("undo");
    expect(bindingFor(ev({ metaKey: true, shiftKey: true, key: "z" }))?.id).toBe("redo");
    expect(bindingFor(ev({ ctrlKey: true, key: "y" }))?.id).toBe("redo");
    expect(bindingFor(ev({ key: "a" }))).toBeNull();
  });
});

describe("comboTokens / formatCombo", () => {
  it("renders platform-specific chords", () => {
    expect(comboTokens({ mod: true, shift: true, key: "z" }, true)).toEqual(["⌘", "⇧", "Z"]);
    expect(comboTokens({ mod: true, shift: true, key: "z" }, false)).toEqual(["Ctrl", "Shift", "Z"]);
    expect(comboTokens({ mod: true, key: "Enter" }, true)).toEqual(["⌘", "↵"]);
    expect(formatCombo({ mod: true, key: "s" }, true)).toBe("⌘S");
    expect(formatCombo({ mod: true, key: "s" }, false)).toBe("Ctrl+S");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun x vitest run src/lib/keybindings.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/keybindings"`.

- [ ] **Step 3: Implement `keybindings.ts`**

Create `src/lib/keybindings.ts`:

```ts
// keybindings.ts — single source of truth for app keyboard shortcuts.
//
// The global keydown dispatcher (App.tsx) and the read-only Settings list both
// read KEYBINDINGS, so documented shortcuts can't drift from the handlers.
// `mod` means Cmd on macOS / Ctrl elsewhere.

export interface Combo {
  /** Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** KeyboardEvent.key, compared case-insensitively (e.g. "s", "Enter"). */
  key: string;
}

export type KeybindingId = "save-build" | "split" | "undo" | "redo";

export interface Keybinding {
  id: KeybindingId;
  label: string;
  description: string;
  /** Matches if ANY listed combo matches the event. */
  combos: Combo[];
  scope: "global" | "editor";
}

export const KEYBINDINGS: Keybinding[] = [
  {
    id: "save-build",
    label: "Save & build PDF",
    description: "Write the chapter to disk and recompile the PDF.",
    combos: [{ mod: true, key: "s" }],
    scope: "global",
  },
  {
    id: "split",
    label: "Split block at cursor",
    description: "Break the current block into two at the caret.",
    combos: [{ mod: true, key: "Enter" }],
    scope: "editor",
  },
  {
    id: "undo",
    label: "Undo",
    description: "Undo the last editor change.",
    combos: [{ mod: true, key: "z" }],
    scope: "editor",
  },
  {
    id: "redo",
    label: "Redo",
    description: "Redo the last undone change.",
    combos: [
      { mod: true, shift: true, key: "z" },
      { mod: true, key: "y" },
    ],
    scope: "editor",
  },
];

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function matchesCombo(e: KeyboardEvent, combo: Combo): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!!combo.mod !== mod) return false;
  if (!!combo.shift !== e.shiftKey) return false;
  if (!!combo.alt !== e.altKey) return false;
  return e.key.toLowerCase() === combo.key.toLowerCase();
}

export function bindingFor(e: KeyboardEvent): Keybinding | null {
  for (const binding of KEYBINDINGS) {
    if (binding.combos.some((c) => matchesCombo(e, c))) return binding;
  }
  return null;
}

function keyLabel(key: string, mac: boolean): string {
  switch (key.toLowerCase()) {
    case "enter":
      return mac ? "↵" : "Enter";
    case "escape":
      return "Esc";
    case " ":
      return "Space";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/** Tokens for a chord, one per <Kbd> chip (e.g. ["⌘","⇧","Z"]). */
export function comboTokens(combo: Combo, mac: boolean): string[] {
  const tokens: string[] = [];
  if (combo.mod) tokens.push(mac ? "⌘" : "Ctrl");
  if (combo.shift) tokens.push(mac ? "⇧" : "Shift");
  if (combo.alt) tokens.push(mac ? "⌥" : "Alt");
  tokens.push(keyLabel(combo.key, mac));
  return tokens;
}

/** Flat string form for title/aria-label use. */
export function formatCombo(combo: Combo, mac: boolean): string {
  const tokens = comboTokens(combo, mac);
  return mac ? tokens.join("") : tokens.join("+");
}

/** Tokens for a binding's primary combo, platform-resolved — for inline hints. */
export function primaryTokens(id: KeybindingId): string[] {
  const binding = KEYBINDINGS.find((b) => b.id === id);
  if (!binding) return [];
  return comboTokens(binding.combos[0], isMac());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun x vitest run src/lib/keybindings.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `just typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/keybindings.ts src/lib/keybindings.test.ts
git commit -m "feat: keybindings registry"
```

---

## Task 4: Store actions `splitBlock` / `convertSelection`

**Files:**
- Modify: `src/stores/project-store.ts`

The cutting logic is already proven in Task 2; these actions are thin splices that reuse the existing `capPush` history pattern (one undo step each).

- [ ] **Step 1: Import the carve helpers**

Find the existing latex import block near the top:

```ts
import {
  countWords,
  parseChapter,
  serializeChapter,
} from "@/lib/latex";
```

Add directly below it:

```ts
import { planCarve, planSplit } from "@/lib/blocks/carve";
```

- [ ] **Step 2: Declare the actions in the `ProjectState` interface**

Find the `// block editing` section of the interface:

```ts
  insertAfter: (afterId: string | null, partial?: Partial<Block>) => string;
  deleteBlock: (id: string) => void;
  moveBlock: (id: string, dir: -1 | 1) => void;
```

Insert after the `insertAfter` line:

```ts
  splitBlock: (id: string, at: number) => void;
  convertSelection: (id: string, start: number, end: number, type: BlockType) => void;
```

- [ ] **Step 3: Implement the actions**

Find the end of the `insertAfter` implementation (it returns `id;` then `},`). Immediately after that closing `},`, add:

```ts
    splitBlock: (id, at) =>
      set((s) => {
        const idx = s.blocks.findIndex((b) => b.id === id);
        if (idx < 0) return {};
        const plan = planSplit(s.blocks[idx], at);
        if (plan.blocks.length < 2) return {}; // caret at an edge — nothing to do
        const next = [...s.blocks];
        next.splice(idx, 1, ...plan.blocks);
        return {
          blocks: next,
          selectedId: plan.focusId,
          chapterDirty: true,
          past: capPush(s.past, s.blocks),
          future: [],
          lastTextEditId: null,
        };
      }),

    convertSelection: (id, start, end, type) =>
      set((s) => {
        const idx = s.blocks.findIndex((b) => b.id === id);
        if (idx < 0) return {};
        const plan = planCarve(s.blocks[idx], start, end, type);
        // No-op only when the plan handed back the original block untouched.
        if (plan.blocks.length === 1 && plan.blocks[0] === s.blocks[idx]) return {};
        const next = [...s.blocks];
        next.splice(idx, 1, ...plan.blocks);
        return {
          blocks: next,
          selectedId: plan.focusId,
          chapterDirty: true,
          past: capPush(s.past, s.blocks),
          future: [],
          lastTextEditId: null,
        };
      }),
```

- [ ] **Step 4: Typecheck**

Run: `just typecheck`
Expected: no errors (`BlockType` is already imported in this file; `capPush` is defined above the store).

- [ ] **Step 5: Commit**

```bash
git add src/stores/project-store.ts
git commit -m "feat: splitBlock and convertSelection store actions"
```

---

## Task 5: Selection rect measurement (`textarea-caret.ts`)

**Files:**
- Create: `src/lib/textarea-caret.ts`

Native `<textarea>` selections aren't in the DOM Selection API, so we mirror the textarea into a hidden div and measure a marker span. Verified visually in Task 13 (no unit test — it needs real layout).

- [ ] **Step 1: Implement `textarea-caret.ts`**

Create `src/lib/textarea-caret.ts`:

```ts
// textarea-caret.ts — locate a <textarea> selection on screen.
//
// The DOM Selection API ignores text inside a <textarea>, so to anchor the
// selection toolbar above the highlight we mirror the textarea into a hidden div
// with identical styling, place a marker span at the selection, and read its
// box. Based on the well-known textarea-caret-position technique.

const MIRRORED_PROPERTIES = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "whiteSpace",
  "wordWrap",
  "wordBreak",
] as const;

/**
 * Viewport-relative rect spanning the textarea selection [start, end].
 * Returns null if the textarea isn't in a laid-out document.
 */
export function selectionRect(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
): DOMRect | null {
  const doc = textarea.ownerDocument;
  const win = doc.defaultView;
  if (!win) return null;

  const div = doc.createElement("div");
  const style = div.style;
  const computed = win.getComputedStyle(textarea);

  style.position = "absolute";
  style.top = "0";
  style.left = "-9999px";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.overflow = "hidden";
  style.height = "auto";
  for (const prop of MIRRORED_PROPERTIES) {
    style.setProperty(
      prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
      computed.getPropertyValue(prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)),
    );
  }

  div.textContent = textarea.value.slice(0, start);
  const marker = doc.createElement("span");
  // Non-empty so it has a measurable box even for a collapsed selection.
  marker.textContent = textarea.value.slice(start, end) || ".";
  div.appendChild(marker);
  doc.body.appendChild(div);

  const top = marker.offsetTop;
  const left = marker.offsetLeft;
  const height = marker.offsetHeight;
  const width = marker.offsetWidth;
  doc.body.removeChild(div);

  const taRect = textarea.getBoundingClientRect();
  return new DOMRect(
    taRect.left + left - textarea.scrollLeft,
    taRect.top + top - textarea.scrollTop,
    width,
    height,
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `just typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/textarea-caret.ts
git commit -m "feat: textarea selection rect measurement"
```

---

## Task 6: Forward `proseBody` marker through `AutoGrowTextarea`

**Files:**
- Modify: `src/components/app/auto-textarea.tsx`

- [ ] **Step 1: Add the `proseBody` prop and emit `data-prose-body`**

Replace the whole component body. New `src/components/app/auto-textarea.tsx`:

```tsx
// auto-textarea.tsx — a borderless textarea that grows to fit its content, so
// editing a block feels like editing prose in place rather than a form field.

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function AutoGrowTextarea({
  value,
  onChange,
  className,
  autoFocus,
  placeholder,
  onKeyDown,
  proseBody,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Mark this as a carve-eligible prose body (selection toolbar + split shortcut). */
  proseBody?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      rows={1}
      spellCheck
      onKeyDown={onKeyDown}
      onChange={(e) => onChange(e.currentTarget.value)}
      data-prose-body={proseBody ? "" : undefined}
      className={cn(
        "w-full resize-none border-0 bg-transparent p-0 outline-none placeholder:text-faint focus:ring-0",
        className,
      )}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `just typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/auto-textarea.tsx
git commit -m "feat: proseBody marker on AutoGrowTextarea"
```

---

## Task 7: Mark carve-eligible bodies in `block.tsx`

**Files:**
- Modify: `src/components/app/block.tsx`

Add `proseBody` to exactly three `AutoGrowTextarea` instances: narration, the dialogue utterance body, and the lore/scratchpad body. Do NOT add it to the chapter scene heading, the dialogue beat, the lore title `<input>`, or the raw latex textarea.

- [ ] **Step 1: Mark the dialogue utterance body**

Find (the textarea with the "What do they say?" placeholder):

```tsx
              <AutoGrowTextarea
                value={block.text}
                onChange={(v) => updateBlockText(block.id, v)}
                autoFocus
                placeholder="What do they say?"
                className={PROSE}
              />
```

Add `proseBody` to it:

```tsx
              <AutoGrowTextarea
                value={block.text}
                onChange={(v) => updateBlockText(block.id, v)}
                autoFocus
                placeholder="What do they say?"
                className={PROSE}
                proseBody
              />
```

- [ ] **Step 2: Mark the lore/scratchpad body**

Find (the textarea with the `isLore ? "Worldbuilding note…"` placeholder):

```tsx
            <AutoGrowTextarea
              value={block.text}
              onChange={(v) => updateBlockText(block.id, v)}
              autoFocus
              placeholder={isLore ? "Worldbuilding note…" : "Brainstorm, reminders…"}
              className="font-ui text-[13px] leading-[1.55]"
            />
```

Add `proseBody`:

```tsx
            <AutoGrowTextarea
              value={block.text}
              onChange={(v) => updateBlockText(block.id, v)}
              autoFocus
              placeholder={isLore ? "Worldbuilding note…" : "Brainstorm, reminders…"}
              className="font-ui text-[13px] leading-[1.55]"
              proseBody
            />
```

- [ ] **Step 3: Mark the narration body**

Find (the `narration` case's editing textarea with the "Write…" placeholder):

```tsx
        <AutoGrowTextarea
          value={block.text}
          onChange={(v) => updateBlockText(block.id, v)}
          autoFocus
          placeholder="Write…"
          className={PROSE}
        />
```

Add `proseBody`:

```tsx
        <AutoGrowTextarea
          value={block.text}
          onChange={(v) => updateBlockText(block.id, v)}
          autoFocus
          placeholder="Write…"
          className={PROSE}
          proseBody
        />
```

- [ ] **Step 4: Typecheck**

Run: `just typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/app/block.tsx
git commit -m "feat: mark carve-eligible prose bodies"
```

---

## Task 8: Floating selection toolbar

**Files:**
- Create: `src/components/app/selection-toolbar.tsx`

Verified visually in Task 13. Note the CLAUDE.md rule: no inline `style` objects for styling — dynamic coordinates go through a CSS variable, consumed by Tailwind arbitrary-value classes.

- [ ] **Step 1: Implement `selection-toolbar.tsx`**

Create `src/components/app/selection-toolbar.tsx`:

```tsx
// selection-toolbar.tsx — a floating bar above a text selection inside a prose
// block body. One instance for the whole editor: it watches the focused
// [data-prose-body] textarea, and its buttons carve the selection into a new
// block (or isolate it as the same type) via the project store.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconScissors } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/stores/project-store";
import { selectionRect } from "@/lib/textarea-caret";
import type { BlockType } from "@/lib/types";
import { cn } from "@/lib/utils";

const CONVERT_TARGETS: { type: BlockType; label: string }[] = [
  { type: "narration", label: "Narration" },
  { type: "dialogue", label: "Dialogue" },
  { type: "lore", label: "Lore" },
  { type: "scratchpad", label: "Scratchpad" },
];

interface Selection {
  blockId: string;
  start: number;
  end: number;
  rect: DOMRect;
}

export function SelectionToolbar() {
  const [sel, setSel] = useState<Selection | null>(null);
  const blocks = useProjectStore((s) => s.blocks);
  const convertSelection = useProjectStore((s) => s.convertSelection);

  const recompute = useCallback(() => {
    const el = document.activeElement;
    if (
      !(el instanceof HTMLTextAreaElement) ||
      !el.matches("[data-prose-body]") ||
      el.selectionStart === el.selectionEnd
    ) {
      setSel(null);
      return;
    }
    const host = el.closest("[data-block-id]");
    const blockId = host instanceof HTMLElement ? host.dataset.blockId : undefined;
    if (!blockId) {
      setSel(null);
      return;
    }
    const rect = selectionRect(el, el.selectionStart, el.selectionEnd);
    if (!rect) {
      setSel(null);
      return;
    }
    setSel({ blockId, start: el.selectionStart, end: el.selectionEnd, rect });
  }, []);

  useEffect(() => {
    let raf = 0;
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recompute);
    };
    document.addEventListener("selectionchange", onChange);
    window.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", onChange);
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
    };
  }, [recompute]);

  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSel(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sel]);

  if (!sel) return null;
  const block = blocks.find((b) => b.id === sel.blockId);
  if (!block) return null;

  const targets = CONVERT_TARGETS.filter((t) => t.type !== block.type);
  const apply = (type: BlockType) => {
    convertSelection(sel.blockId, sel.start, sel.end, type);
    setSel(null);
  };

  // Flip below the selection when there isn't room above.
  const below = sel.rect.top < 56;
  const x = sel.rect.left + sel.rect.width / 2;
  const y = below ? sel.rect.bottom + 8 : sel.rect.top - 8;

  return createPortal(
    <div
      role="toolbar"
      onMouseDown={(e) => e.preventDefault()}
      style={{ "--tb-x": `${x}px`, "--tb-y": `${y}px` } as React.CSSProperties}
      className={cn(
        "fixed z-50 left-[var(--tb-x)] top-[var(--tb-y)] -translate-x-1/2",
        below ? "translate-y-0" : "-translate-y-full",
        "flex items-center gap-0.5 rounded-lg border border-line-soft bg-card p-1 font-ui shadow-md",
      )}
    >
      {targets.map((t) => (
        <Button key={t.type} variant="ghost" size="xs" onClick={() => apply(t.type)}>
          → {t.label}
        </Button>
      ))}
      <Button variant="ghost" size="xs" onClick={() => apply(block.type)} title="Isolate as its own block">
        <IconScissors className="size-3.5" /> Split
      </Button>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `just typecheck`
Expected: no errors. (If `IconScissors` is reported missing, it's exported by `@tabler/icons-react`; confirm the import name resolves.)

- [ ] **Step 3: Commit**

```bash
git add src/components/app/selection-toolbar.tsx
git commit -m "feat: floating selection toolbar"
```

---

## Task 9: Mount the toolbar in the editor

**Files:**
- Modify: `src/components/app/editor.tsx`

- [ ] **Step 1: Import the toolbar**

Find:

```tsx
import { Block } from "@/components/app/block";
```

Add below it:

```tsx
import { SelectionToolbar } from "@/components/app/selection-toolbar";
```

- [ ] **Step 2: Render it once**

Find the end of the block list + cursor row:

```tsx
        {blocks.map((b) => (
          <Block key={b.id} block={b} dictation={dictation} />
        ))}

        <CursorRow />
      </div>
    </ScrollArea>
```

Insert `<SelectionToolbar />` after `<CursorRow />`:

```tsx
        {blocks.map((b) => (
          <Block key={b.id} block={b} dictation={dictation} />
        ))}

        <CursorRow />
        <SelectionToolbar />
      </div>
    </ScrollArea>
```

- [ ] **Step 3: Typecheck**

Run: `just typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/app/editor.tsx
git commit -m "feat: mount selection toolbar in editor"
```

---

## Task 10: Route shortcuts through the registry in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

`⌘S` now saves+builds (`compileNow` already saves the dirty chapter first), `⌘↵` splits the focused prose block, undo/redo unchanged.

- [ ] **Step 1: Swap the `saveChapter` selector for `bindingFor` import**

Find:

```tsx
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
```

Add below them:

```tsx
import { bindingFor } from "@/lib/keybindings";
```

Then find the App-component selectors:

```tsx
  const status = useProjectStore((s) => s.status);
  const saveChapter = useProjectStore((s) => s.saveChapter);
  const compileNow = useProjectStore((s) => s.compileNow);
```

Replace with (drop `saveChapter` — it's no longer key-bound; split is read via `getState`):

```tsx
  const status = useProjectStore((s) => s.status);
  const compileNow = useProjectStore((s) => s.compileNow);
```

- [ ] **Step 2: Replace the keydown effect**

Find the whole effect (from the `// Keyboard:` comment through its `}, [saveChapter, compileNow]);`) and replace it with:

```tsx
  // Keyboard shortcuts come from the central registry (see src/lib/keybindings.ts):
  // ⌘/Ctrl+S saves & rebuilds the PDF, ⌘/Ctrl+Enter splits the focused prose
  // block at the caret, ⌘/Ctrl+Z / +Shift+Z (or Ctrl+Y) undo/redo. Undo/redo is
  // skipped when focus is inside the AI panel or a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const binding = bindingFor(e);
      if (!binding) return;

      if (binding.id === "save-build") {
        e.preventDefault();
        void compileNow();
        return;
      }

      if (binding.id === "split") {
        const el = document.activeElement;
        if (!(el instanceof HTMLTextAreaElement) || !el.matches("[data-prose-body]")) return;
        const host = el.closest("[data-block-id]");
        const blockId = host instanceof HTMLElement ? host.dataset.blockId : undefined;
        if (!blockId) return;
        e.preventDefault();
        useProjectStore.getState().splitBlock(blockId, el.selectionStart);
        return;
      }

      // undo / redo
      const inAux = (document.activeElement as HTMLElement | null)?.closest(
        '[data-ai-root],[role="dialog"],[role="alertdialog"]',
      );
      if (inAux) return;
      e.preventDefault();
      const store = useProjectStore.getState();
      if (binding.id === "redo") store.redo();
      else store.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compileNow]);
```

- [ ] **Step 3: Typecheck**

Run: `just typecheck`
Expected: no errors (no "unused `saveChapter`" — it's gone).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: dispatch shortcuts via registry; save also builds"
```

---

## Task 11: Save-as-build menu item + Compile-button hint in `top-bar.tsx`

**Files:**
- Modify: `src/components/app/top-bar.tsx`

- [ ] **Step 1: Add imports**

Find:

```tsx
import { SettingsSheet } from "@/components/app/settings-sheet";
import { useProjectStore } from "@/stores/project-store";
import { useViewStore } from "@/stores/view-store";
import { cn } from "@/lib/utils";
```

Add below them:

```tsx
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { primaryTokens } from "@/lib/keybindings";
```

- [ ] **Step 2: Drop the now-unused `saveChapter` / `saving` selectors**

Find:

```tsx
  const chapterDirty = useProjectStore((s) => s.chapterDirty);
  const saving = useProjectStore((s) => s.saving);
  const compiling = useProjectStore((s) => s.compile.status === "compiling");
```

Replace with (keep `chapterDirty` — still used by the unsaved dot):

```tsx
  const chapterDirty = useProjectStore((s) => s.chapterDirty);
  const compiling = useProjectStore((s) => s.compile.status === "compiling");
```

Then find and DELETE this line (it's only used by the menu item we're rewriting):

```tsx
  const saveChapter = useProjectStore((s) => s.saveChapter);
```

- [ ] **Step 3: Rewrite the "Save chapter" menu item as "Save & build PDF"**

Find:

```tsx
          <DropdownMenuItem
            disabled={!chapterDirty || saving}
            onSelect={() => void saveChapter()}
          >
            <IconDeviceFloppy /> Save chapter
          </DropdownMenuItem>
```

Replace with:

```tsx
          <DropdownMenuItem
            disabled={compiling}
            onSelect={() => void compileNow()}
          >
            <IconDeviceFloppy /> Save &amp; build PDF
          </DropdownMenuItem>
```

- [ ] **Step 4: Add the shortcut hint to the Compile button**

Find:

```tsx
          <Button
            size="sm"
            className="font-ui"
            onClick={() => void compileNow()}
            disabled={compiling}
          >
            {compiling ? <IconLoader2 className="animate-spin" /> : <IconPlayerPlayFilled />}
            Compile
          </Button>
```

Replace with:

```tsx
          <Button
            size="sm"
            className="font-ui"
            onClick={() => void compileNow()}
            disabled={compiling}
          >
            {compiling ? <IconLoader2 className="animate-spin" /> : <IconPlayerPlayFilled />}
            Compile
            <KbdGroup className="ml-1">
              {primaryTokens("save-build").map((t, i) => (
                <Kbd key={i}>{t}</Kbd>
              ))}
            </KbdGroup>
          </Button>
```

- [ ] **Step 5: Typecheck**

Run: `just typecheck`
Expected: no errors (no unused `saveChapter`/`saving`).

- [ ] **Step 6: Commit**

```bash
git add src/components/app/top-bar.tsx
git commit -m "feat: save-as-build menu item and compile shortcut hint"
```

---

## Task 12: Keyboard section in Settings

**Files:**
- Modify: `src/components/app/settings-sheet.tsx`

- [ ] **Step 1: Add imports**

Find:

```tsx
import { TypographyEyebrow, TypographyMuted } from "@/components/ui/typography";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";
import type { BlockStyle, LayoutMode, Theme } from "@/lib/types";
```

Add below them:

```tsx
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { KEYBINDINGS, comboTokens, isMac } from "@/lib/keybindings";
```

- [ ] **Step 2: Add the Keyboard section**

Find the closing of the Prose size field and the surrounding `</div>`:

```tsx
          <Field label="Prose size" hint={`${proseSize}px`}>
            <Slider
              min={14}
              max={22}
              step={0.5}
              value={[proseSize]}
              onValueChange={([v]) => setProseSize(v)}
            />
          </Field>
        </div>
```

Replace with (insert a `Separator` + the Keyboard `Field` before the closing `</div>`):

```tsx
          <Field label="Prose size" hint={`${proseSize}px`}>
            <Slider
              min={14}
              max={22}
              step={0.5}
              value={[proseSize]}
              onValueChange={([v]) => setProseSize(v)}
            />
          </Field>

          <Separator />

          <Field label="Keyboard">
            <div className="flex flex-col gap-2">
              {KEYBINDINGS.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-foreground">{b.label}</span>
                  <div className="flex items-center gap-1.5">
                    {b.combos.map((c, i) => (
                      <span key={i} className="flex items-center gap-1.5">
                        {i > 0 ? <span className="text-xs text-faint">or</span> : null}
                        <KbdGroup>
                          {comboTokens(c, isMac()).map((t, j) => (
                            <Kbd key={j}>{t}</Kbd>
                          ))}
                        </KbdGroup>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <TypographyMuted className="mt-1 font-ui text-xs">
              Highlight text in a block to convert or isolate the selection.
            </TypographyMuted>
          </Field>
        </div>
```

- [ ] **Step 3: Typecheck**

Run: `just typecheck`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `bun x vitest run`
Expected: all tests from Tasks 2 and 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/app/settings-sheet.tsx
git commit -m "feat: keyboard shortcuts section in settings"
```

---

## Task 13: Manual end-to-end verification

**Files:** none (run the app)

- [ ] **Step 1: Launch the app**

Run: `just run`
Expected: the Tauri window opens; open the Prelude project (`/home/jsp/Projects/prelude`) and select a chapter.

- [ ] **Step 2: Verify split-at-cursor**

Click into a narration block, place the caret mid-sentence, press `⌘/Ctrl+Enter`.
Expected: the block becomes two narration blocks at the caret; the second is selected with the caret at its start; the trailing PDF is unaffected until you build.

- [ ] **Step 3: Verify convert-selection**

In a narration block, highlight a quoted phrase like `"Run now."`.
Expected: a toolbar appears above the highlight with `→ Dialogue`, `→ Lore`, `→ Scratchpad`, and `✂ Split`. Click `→ Dialogue`.
Expected: the slice becomes a dialogue block (quotes stripped, rendered via the block's own quotes, no speaker yet); text before/after remain narration; the new dialogue block is selected so the speaker chip is reachable.

- [ ] **Step 4: Verify isolate (✂ Split with a selection) and emphasis**

Highlight a sentence containing italics (`_like this_`) and click `✂ Split`.
Expected: the selection becomes its own same-type block; italics render correctly on every resulting piece (no stray `_`).

- [ ] **Step 5: Verify save = build**

Press `⌘/Ctrl+S`.
Expected: the build badge goes to "compiling…" then "build clean"; the PDF pane (if open) refreshes. The File menu shows "Save & build PDF"; the Compile button shows the `⌘S` / `Ctrl S` hint.

- [ ] **Step 6: Verify Settings list and undo**

Open Settings → confirm the Keyboard section lists Save & build (`⌘S`), Split (`⌘↵`), Undo (`⌘Z`), Redo (`⌘⇧Z` or `Ctrl Y`). Press `⌘/Ctrl+Z` after a split/convert.
Expected: each carve/split undoes in a single step.

- [ ] **Step 7: Final commit (if any tuning was needed)**

If the toolbar anchor needed tuning in `textarea-caret.ts` / `selection-toolbar.tsx`, commit it:

```bash
git add -A
git commit -m "fix: tune selection toolbar positioning"
```

---

## Notes for the executor

- **Toolbar positioning fallback:** if the mirror-div anchor in `textarea-caret.ts` proves unreliable across line-wrap/scroll, the spec sanctions a simpler fallback — anchor the toolbar to the block's top-right instead of the selection. Keep the same buttons and actions.
- **Concurrent agents:** if a named anchor in a "Find" step has shifted, locate the equivalent code by its surrounding context rather than the quoted line; the edits are small and self-describing.
- **Comprehensive testing** (component tests for the toolbar/keydown, integration tests for the store) is intentionally out of scope here and handled by other agents; this plan establishes the Vitest harness and pure-logic coverage they build on.
