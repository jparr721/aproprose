# PDF Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable full-document PDF search with exact PDF.js highlighting while routing Cmd/Ctrl+F to the last active editor or PDF pane.

**Architecture:** A small Zustand store owns active and open search-surface state. The existing editor find store retains editor query and replacement data, while a new PDF find store owns PDF query and result state. A typed adapter wraps PDF.js `PDFViewer`, `PDFFindController`, `EventBus`, and `PDFLinkService`; the React PDF pane keeps Aproprose's toolbar and controls the adapter.

**Tech Stack:** React 19, TypeScript 5.8 strict mode, Zustand 5, PDF.js 6.0.227, Vite 7, Tailwind 4, Radix/shadcn UI, Vitest 4 with happy-dom, Tauri 2.

## Global Constraints

- Use the installed `pdfjs-dist` dependency. Do not add or upgrade dependencies.
- Before Task 1, verify `git merge-base --is-ancestor origin/main HEAD` exits 0.
- Use PDF.js `PDFViewer`, `PDFFindController`, `EventBus`, and `PDFLinkService`; do not embed the stock viewer application or toolbar.
- Keep the existing React PDF toolbar, compiled-byte loading, page field, persisted zoom, recompile action, close action, and copy-path behavior.
- PDF search supports literal text, match case, and whole word. It does not support replacement, regular expressions, or OCR.
- Cmd/Ctrl+F remains the single `OPEN_FIND` registry binding and routes to the last clicked or focused editor/PDF surface.
- Editor and PDF queries remain independent. At most one find bar is open.
- Use Zustand for state shared across unrelated components.
- Use `Spinner` for pending search state. Do not use loading punctuation.
- Use semantic theme tokens and Tailwind classes. Do not add inline `style` objects.
- Use shared typography, tooltip, input-group, and button primitives.
- Keep all new source and UI text ASCII-only.
- Use `just` recipes when one covers the command.
- Follow TDD for every task and commit each completed task independently.
- Treat the approved design as authoritative: `docs/superpowers/specs/2026-07-30-pdf-search-design.md`.

---

## File Map

### New files

- `src/stores/search-surface-store.ts` - active/open search-surface state and focus revision.
- `src/stores/search-surface-store.test.ts` - state transition tests.
- `src/components/app/search-coordinator.tsx` - owns the single `OPEN_FIND` binding and PDF availability reset.
- `src/components/app/search-coordinator.test.tsx` - shortcut routing and availability tests.
- `src/components/app/find-bar.test.tsx` - editor find-bar integration with shared open state.
- `src/lib/pdf/find.ts` - shared PDF find query/result types.
- `src/stores/pdf-find-store.ts` - PDF query, options, count, status, and error state.
- `src/stores/pdf-find-store.test.ts` - PDF find-state transition tests.
- `src/components/app/find-option-toggle.tsx` - option toggle shared by editor and PDF find bars.
- `src/components/app/pdf-find-bar.tsx` - PDF search controls.
- `src/components/app/pdf-find-bar.test.tsx` - PDF find-bar keyboard and state tests.
- `src/lib/pdf/viewer-runtime.ts` - worker setup and deferred PDF.js viewer-module loading.
- `src/lib/pdf/viewer-adapter.ts` - typed functional wrapper around PDF.js viewer objects.
- `src/lib/pdf/viewer-adapter.test.ts` - event, lifecycle, search, and cleanup tests with a fake runtime.
- `src/types/pdfjs-viewer.d.ts` - correct the installed PDF.js viewer's null-document declaration.
- `src/components/app/pdf-pane.test.tsx` - PDF pane lifecycle, search, active state, and tooltip tests.

### Modified files

- `src/stores/find-store.ts` - remove duplicated open/focus state and expose result clearing.
- `src/stores/find-store.test.ts` - stop seeding removed state and retain matcher coverage.
- `src/components/app/find-bar.tsx` - consume shared open/focus state and shared option toggle.
- `src/components/app/editor.tsx` - activate editor search on pointer/focus and remove the local `OPEN_FIND` binding.
- `src/App.tsx` - mount `SearchCoordinator` with live PDF availability.
- `src/lib/keybindings.ts` - describe `OPEN_FIND` as active-pane find.
- `src/lib/keybindings.test.ts` - assert the updated registry description.
- `src/components/app/pdf-pane.tsx` - replace the custom canvas stack with the PDF.js adapter and add PDF search.
- `src/index.css` - import official viewer CSS in a layer and add scoped token-based PDF overrides.

---

### Task 1: Add shared search-surface state

**Files:**

- Create: `src/stores/search-surface-store.ts`
- Create: `src/stores/search-surface-store.test.ts`

**Interfaces:**

- Produces: `SearchSurface = "editor" | "pdf"`.
- Produces: `useSearchSurfaceStore` with `activeSurface`, `openSurface`, `focusRevision`, `activate(surface)`, `openActive()`, `close(surface)`, and `removePdf()`.
- Consumes: Zustand `create`.

- [ ] **Step 1: Write the failing store tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";

beforeEach(() => {
  useSearchSurfaceStore.setState({
    activeSurface: "editor",
    openSurface: null,
    focusRevision: 0,
  });
});

describe("search surface state", () => {
  it("opens the active surface and replaces the other open surface", () => {
    useSearchSurfaceStore.getState().openActive();
    expect(useSearchSurfaceStore.getState().openSurface).toBe("editor");

    useSearchSurfaceStore.getState().activate("pdf");
    useSearchSurfaceStore.getState().openActive();
    expect(useSearchSurfaceStore.getState().openSurface).toBe("pdf");
  });

  it("increments focus revision when an open surface is reopened", () => {
    useSearchSurfaceStore.getState().openActive();
    useSearchSurfaceStore.getState().openActive();
    expect(useSearchSurfaceStore.getState().focusRevision).toBe(2);
  });

  it("only closes the requested open surface", () => {
    useSearchSurfaceStore.getState().openActive();
    useSearchSurfaceStore.getState().close("pdf");
    expect(useSearchSurfaceStore.getState().openSurface).toBe("editor");
    useSearchSurfaceStore.getState().close("editor");
    expect(useSearchSurfaceStore.getState().openSurface).toBeNull();
  });

  it("returns to editor when the PDF surface becomes unavailable", () => {
    useSearchSurfaceStore.setState({
      activeSurface: "pdf",
      openSurface: "pdf",
      focusRevision: 3,
    });
    useSearchSurfaceStore.getState().removePdf();
    expect(useSearchSurfaceStore.getState()).toMatchObject({
      activeSurface: "editor",
      openSurface: null,
      focusRevision: 3,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun x vitest run src/stores/search-surface-store.test.ts
```

Expected: FAIL because `@/stores/search-surface-store` does not exist.

- [ ] **Step 3: Implement the store**

```ts
import { create } from "zustand";

export type SearchSurface = "editor" | "pdf";

interface SearchSurfaceState {
  activeSurface: SearchSurface;
  openSurface: SearchSurface | null;
  focusRevision: number;
  activate: (surface: SearchSurface) => void;
  openActive: () => void;
  close: (surface: SearchSurface) => void;
  removePdf: () => void;
}

export const useSearchSurfaceStore = create<SearchSurfaceState>((set, get) => ({
  activeSurface: "editor",
  openSurface: null,
  focusRevision: 0,
  activate: (activeSurface) => set({ activeSurface }),
  openActive: () =>
    set((state) => ({
      openSurface: state.activeSurface,
      focusRevision: state.focusRevision + 1,
    })),
  close: (surface) => {
    if (get().openSurface === surface) set({ openSurface: null });
  },
  removePdf: () =>
    set((state) => ({
      activeSurface: state.activeSurface === "pdf" ? "editor" : state.activeSurface,
      openSurface: state.openSurface === "pdf" ? null : state.openSurface,
    })),
}));
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
bun x vitest run src/stores/search-surface-store.test.ts
```

Expected: PASS with 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/stores/search-surface-store.ts src/stores/search-surface-store.test.ts
git commit -m "feat: add active search surface state"
```

---

### Task 2: Route editor find through the shared surface

**Files:**

- Create: `src/components/app/search-coordinator.tsx`
- Create: `src/components/app/search-coordinator.test.tsx`
- Create: `src/components/app/find-bar.test.tsx`
- Modify: `src/stores/find-store.ts:16-66`
- Modify: `src/stores/find-store.test.ts:44-58`
- Modify: `src/components/app/find-bar.tsx:52-116`
- Modify: `src/components/app/editor.tsx:47-53, 226-228, 338-400`
- Verify: `src/components/app/editor.delete-block.test.tsx`
- Modify: `src/App.tsx:38-50, 52-122`
- Modify: `src/lib/keybindings.ts:92-99`
- Modify: `src/lib/keybindings.test.ts:1-25`

**Interfaces:**

- Consumes: `useSearchSurfaceStore` from Task 1.
- Produces: `SearchCoordinator({ pdfAvailable }: { pdfAvailable: boolean }): null`.
- Changes: editor `FindState` removes `open`, `focusTick`, and `openFind`.
- Produces: editor `clearResults(): void`, which retains query, replacement, and options.

- [ ] **Step 1: Write failing coordinator and editor find-bar tests**

Create `search-coordinator.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchCoordinator } from "@/components/app/search-coordinator";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";

const keybinding = vi.hoisted(() => ({
  callback: null as (() => void) | null,
}));

vi.mock("@/hooks/use-keybinding", () => ({
  useKeybinding: (_id: unknown, callback: () => void): void => {
    keybinding.callback = callback;
  },
}));

afterEach(() => cleanup());

beforeEach(() => {
  keybinding.callback = null;
  useSearchSurfaceStore.setState({
    activeSurface: "editor",
    openSurface: null,
    focusRevision: 0,
  });
});

describe("SearchCoordinator", () => {
  it("opens whichever surface is active", () => {
    render(<SearchCoordinator pdfAvailable={true} />);
    useSearchSurfaceStore.getState().activate("pdf");
    act(() => keybinding.callback?.());
    expect(useSearchSurfaceStore.getState().openSurface).toBe("pdf");
  });

  it("removes PDF activation when the pane is unavailable", () => {
    const view = render(<SearchCoordinator pdfAvailable={true} />);
    useSearchSurfaceStore.setState({
      activeSurface: "pdf",
      openSurface: "pdf",
    });
    view.rerender(<SearchCoordinator pdfAvailable={false} />);
    expect(useSearchSurfaceStore.getState()).toMatchObject({
      activeSurface: "editor",
      openSurface: null,
    });
  });
});
```

Create `find-bar.test.tsx` with a minimal project-store mock:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindBar } from "@/components/app/find-bar";
import { useFindStore } from "@/stores/find-store";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";

const projectState = { blocks: [] };

vi.mock("@/stores/project-store", () => {
  const useProjectStore = Object.assign(
    (selector: (state: typeof projectState) => unknown): unknown => selector(projectState),
    { getState: (): typeof projectState => projectState },
  );
  return { useProjectStore };
});

afterEach(() => cleanup());

beforeEach(() => {
  useFindStore.setState({
    query: "chapter",
    replacement: "",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    replaceExpanded: false,
    matches: [],
    currentIndex: -1,
    error: null,
  });
  useSearchSurfaceStore.setState({
    activeSurface: "editor",
    openSurface: "editor",
    focusRevision: 1,
  });
});

describe("FindBar search surface integration", () => {
  it("closes editor search without discarding its query", () => {
    render(<FindBar />);
    fireEvent.click(screen.getByRole("button", { name: "Close find" }));
    expect(useSearchSurfaceStore.getState().openSurface).toBeNull();
    expect(useFindStore.getState().query).toBe("chapter");
  });

  it("does not render while PDF search is open", () => {
    useSearchSurfaceStore.setState({ openSurface: "pdf" });
    render(<FindBar />);
    expect(screen.queryByLabelText("Close find")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
bun x vitest run src/components/app/search-coordinator.test.tsx src/components/app/find-bar.test.tsx src/stores/find-store.test.ts src/lib/keybindings.test.ts
```

Expected: FAIL because `SearchCoordinator` is missing and editor find still owns open/focus state.

- [ ] **Step 3: Refactor editor find state**

In `find-store.ts`:

- Remove `open`, `focusTick`, and `openFind`.
- Replace `close` with `clearResults`.
- Keep query, replacement, options, and `replaceExpanded` unchanged when clearing.

```ts
interface FindState extends FindOptions {
  query: string;
  replacement: string;
  replaceExpanded: boolean;
  matches: Match[];
  currentIndex: number;
  error: string | null;
  clearResults: () => void;
}

clearResults: () =>
  set({
    matches: [],
    currentIndex: -1,
    error: null,
  }),
```

Update `find-store.test.ts` by deleting every seeded `open` and `focusTick` property. The matcher assertions remain unchanged.

- [ ] **Step 4: Make `FindBar` consume shared open state**

Replace editor-store `open`, `focusTick`, and `close` subscriptions with:

```ts
const open = useSearchSurfaceStore((state) => state.openSurface === "editor");
const focusRevision = useSearchSurfaceStore((state) => state.focusRevision);
const closeSurface = useSearchSurfaceStore((state) => state.close);
const clearResults = useFindStore((state) => state.clearResults);

const close = (): void => {
  clearResults();
  closeSurface("editor");
};
```

Use `focusRevision` in the existing focus/select effect. Add an effect that calls `clearResults()` when `open` changes to false so switching directly to PDF search removes editor highlights.

```ts
useEffect(() => {
  if (!open) clearResults();
}, [open, clearResults]);
```

- [ ] **Step 5: Add the coordinator and mount it**

Create `search-coordinator.tsx`:

```tsx
import { useEffect } from "react";
import { useKeybinding } from "@/hooks/use-keybinding";
import { KEYBINDING_IDS } from "@/lib/keybindings";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";

export function SearchCoordinator({ pdfAvailable }: { pdfAvailable: boolean }): null {
  const removePdf = useSearchSurfaceStore((state) => state.removePdf);

  useKeybinding(KEYBINDING_IDS.OPEN_FIND, () => {
    useSearchSurfaceStore.getState().openActive();
  });

  useEffect(() => {
    if (!pdfAvailable) removePdf();
  }, [pdfAvailable, removePdf]);

  return null;
}
```

Mount `<SearchCoordinator pdfAvailable={showPdf} />` inside `Workspace`, before the visible layout. Remove the `OPEN_FIND` binding and `useFindStore` import from `Editor`.

- [ ] **Step 6: Activate editor search from editor interaction**

Subscribe to `activate` in `Editor`:

```ts
const activateSearchSurface = useSearchSurfaceStore((state) => state.activate);
```

Apply these capture handlers to each top-level editor return, including empty and conflict states:

```tsx
onPointerDownCapture={() => activateSearchSurface("editor")}
onFocusCapture={() => activateSearchSurface("editor")}
data-search-surface="editor"
```

Do not use hover handlers.

Preserve the target branch's `DELETE_BLOCK` binding and delete-confirmation dialog unchanged.

- [ ] **Step 7: Update the registry description**

Change `KEYBINDINGS.OPEN_FIND.description` to:

```ts
description: "Find in the active pane",
```

Add this assertion to `keybindings.test.ts`:

```ts
expect(KEYBINDINGS.OPEN_FIND.description).toBe("Find in the active pane");
```

- [ ] **Step 8: Run focused tests and type checking**

Run:

```bash
bun x vitest run src/components/app/search-coordinator.test.tsx src/components/app/find-bar.test.tsx src/components/app/editor.delete-block.test.tsx src/stores/find-store.test.ts src/stores/search-surface-store.test.ts src/lib/keybindings.test.ts
just typecheck
```

Expected: all focused tests PASS and TypeScript reports no errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/app/search-coordinator.tsx src/components/app/search-coordinator.test.tsx src/components/app/find-bar.tsx src/components/app/find-bar.test.tsx src/components/app/editor.tsx src/stores/find-store.ts src/stores/find-store.test.ts src/App.tsx src/lib/keybindings.ts src/lib/keybindings.test.ts
git commit -m "feat: route find to the active pane"
```

---

### Task 3: Add PDF find state and controls

**Files:**

- Create: `src/lib/pdf/find.ts`
- Create: `src/stores/pdf-find-store.ts`
- Create: `src/stores/pdf-find-store.test.ts`
- Create: `src/components/app/find-option-toggle.tsx`
- Create: `src/components/app/pdf-find-bar.tsx`
- Create: `src/components/app/pdf-find-bar.test.tsx`
- Modify: `src/components/app/find-bar.tsx:19-50, 158-176`

**Interfaces:**

- Produces: `PdfFindQuery`, `PdfFindStatus`, and `PdfFindResult`.
- Produces: `usePdfFindStore`.
- Produces: `PdfFindBar({ onNext, onPrevious })`.
- Consumes: `useSearchSurfaceStore` from Task 1.

- [ ] **Step 1: Write failing PDF find-store tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { usePdfFindStore } from "@/stores/pdf-find-store";

beforeEach(() => {
  usePdfFindStore.getState().reset();
});

describe("PDF find state", () => {
  it("resets match-derived state when the query changes", () => {
    usePdfFindStore.getState().setResult({
      status: "found",
      current: 2,
      total: 5,
      error: null,
    });
    usePdfFindStore.getState().setQuery("Chapter Seven");
    expect(usePdfFindStore.getState()).toMatchObject({
      query: "Chapter Seven",
      status: "idle",
      current: 0,
      total: 0,
      error: null,
    });
  });

  it("retains query and options when a document reload clears results", () => {
    usePdfFindStore.getState().setQuery("arrival");
    usePdfFindStore.getState().toggleCase();
    usePdfFindStore.getState().resetMatches();
    expect(usePdfFindStore.getState()).toMatchObject({
      query: "arrival",
      caseSensitive: true,
      status: "idle",
      current: 0,
      total: 0,
    });
  });

  it("stores explicit search errors", () => {
    usePdfFindStore.getState().setError("Text extraction failed");
    expect(usePdfFindStore.getState()).toMatchObject({
      status: "error",
      error: "Text extraction failed",
      current: 0,
      total: 0,
    });
  });
});
```

- [ ] **Step 2: Run the store test to verify it fails**

Run:

```bash
bun x vitest run src/stores/pdf-find-store.test.ts
```

Expected: FAIL because the PDF find types and store do not exist.

- [ ] **Step 3: Add strict PDF find types and store**

Create `src/lib/pdf/find.ts`:

```ts
export interface PdfFindQuery {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export type PdfFindStatus =
  | "idle"
  | "pending"
  | "found"
  | "not-found"
  | "wrapped"
  | "error";

export interface PdfFindResult {
  status: PdfFindStatus;
  current: number;
  total: number;
  error: string | null;
}

export const EMPTY_PDF_FIND_RESULT: PdfFindResult = {
  status: "idle",
  current: 0,
  total: 0,
  error: null,
};
```

Create `src/stores/pdf-find-store.ts`:

```ts
import { create } from "zustand";
import {
  EMPTY_PDF_FIND_RESULT,
  type PdfFindQuery,
  type PdfFindResult,
} from "@/lib/pdf/find";

interface PdfFindState extends PdfFindQuery, PdfFindResult {
  setQuery: (query: string) => void;
  toggleCase: () => void;
  toggleWholeWord: () => void;
  setPending: () => void;
  setResult: (result: PdfFindResult) => void;
  setError: (message: string) => void;
  resetMatches: () => void;
  reset: () => void;
}

const initialState: PdfFindQuery & PdfFindResult = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  status: EMPTY_PDF_FIND_RESULT.status,
  current: EMPTY_PDF_FIND_RESULT.current,
  total: EMPTY_PDF_FIND_RESULT.total,
  error: EMPTY_PDF_FIND_RESULT.error,
};

export const usePdfFindStore = create<PdfFindState>((set) => ({
  query: initialState.query,
  caseSensitive: initialState.caseSensitive,
  wholeWord: initialState.wholeWord,
  status: initialState.status,
  current: initialState.current,
  total: initialState.total,
  error: initialState.error,
  setQuery: (query) =>
    set({
      query,
      status: "idle",
      current: 0,
      total: 0,
      error: null,
    }),
  toggleCase: () =>
    set((state) => ({
      caseSensitive: !state.caseSensitive,
      status: "idle",
      current: 0,
      total: 0,
      error: null,
    })),
  toggleWholeWord: () =>
    set((state) => ({
      wholeWord: !state.wholeWord,
      status: "idle",
      current: 0,
      total: 0,
      error: null,
    })),
  setPending: () => set({ status: "pending", error: null }),
  setResult: (result) => set(result),
  setError: (error) =>
    set({
      status: "error",
      current: 0,
      total: 0,
      error,
    }),
  resetMatches: () => set(EMPTY_PDF_FIND_RESULT),
  reset: () => set(initialState),
}));
```

- [ ] **Step 4: Run PDF find-store tests**

Run:

```bash
bun x vitest run src/stores/pdf-find-store.test.ts
```

Expected: PASS with 3 tests.

- [ ] **Step 5: Write failing PDF find-bar tests**

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfFindBar } from "@/components/app/pdf-find-bar";
import { usePdfFindStore } from "@/stores/pdf-find-store";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";

afterEach(() => cleanup());

beforeEach(() => {
  usePdfFindStore.getState().reset();
  useSearchSurfaceStore.setState({
    activeSurface: "pdf",
    openSurface: "pdf",
    focusRevision: 1,
  });
});

describe("PdfFindBar", () => {
  it("updates its independent query and options", () => {
    render(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Find in PDF"), {
      target: { value: "Chapter Twelve" },
    });
    fireEvent.click(screen.getByTitle("Match case"));
    fireEvent.click(screen.getByTitle("Match whole word"));
    expect(usePdfFindStore.getState()).toMatchObject({
      query: "Chapter Twelve",
      caseSensitive: true,
      wholeWord: true,
    });
  });

  it("routes Enter and Shift+Enter in opposite directions", () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    usePdfFindStore.getState().setResult({
      status: "found",
      current: 1,
      total: 2,
      error: null,
    });
    render(<PdfFindBar onNext={onNext} onPrevious={onPrevious} />);
    const input = screen.getByLabelText("Find in PDF");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape while retaining the PDF query", () => {
    usePdfFindStore.getState().setQuery("arrival");
    render(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    fireEvent.keyDown(screen.getByLabelText("Find in PDF"), { key: "Escape" });
    expect(useSearchSurfaceStore.getState().openSurface).toBeNull();
    expect(usePdfFindStore.getState().query).toBe("arrival");
  });

  it("shows pending, count, no-results, and error states", () => {
    const view = render(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    usePdfFindStore.getState().setPending();
    view.rerender(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    expect(screen.getByLabelText("Searching PDF")).toBeTruthy();

    usePdfFindStore.getState().setResult({
      status: "found",
      current: 2,
      total: 7,
      error: null,
    });
    view.rerender(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    expect(screen.getByText("2 of 7")).toBeTruthy();

    usePdfFindStore.getState().setResult({
      status: "not-found",
      current: 0,
      total: 0,
      error: null,
    });
    view.rerender(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    expect(screen.getByText("No results")).toBeTruthy();

    usePdfFindStore.getState().setError("Search unavailable");
    view.rerender(<PdfFindBar onNext={vi.fn()} onPrevious={vi.fn()} />);
    expect(screen.getByText("Search unavailable")).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run the PDF find-bar test to verify it fails**

Run:

```bash
bun x vitest run src/components/app/pdf-find-bar.test.tsx
```

Expected: FAIL because `PdfFindBar` and the shared option toggle do not exist.

- [ ] **Step 7: Extract the option toggle and build `PdfFindBar`**

Move the existing `OptionToggle` markup from `find-bar.tsx` into `find-option-toggle.tsx`:

```tsx
import type { ReactNode } from "react";
import { InputGroupButton } from "@/components/ui/input-group";

export function FindOptionToggle({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <InputGroupButton
      size="icon-xs"
      variant={active ? "secondary" : "ghost"}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {children}
    </InputGroupButton>
  );
}
```

Use `FindOptionToggle` from both find bars. `PdfFindBar` must:

- Read `openSurface === "pdf"` and `focusRevision`.
- Focus and select its input whenever it opens or is reopened.
- Render `Spinner` with `aria-label="Searching PDF"` for pending state.
- Render `"current of total"`, `"No results"`, or the error string exactly.
- Disable next/previous when pending, errored, or total is zero.
- Call `close("pdf")` on Escape or close-button activation.
- Set `data-find-widget` on its root.

```tsx
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
```

- [ ] **Step 8: Run the new component and regression tests**

Run:

```bash
bun x vitest run src/components/app/pdf-find-bar.test.tsx src/components/app/find-bar.test.tsx src/stores/pdf-find-store.test.ts src/stores/find-store.test.ts
just typecheck
```

Expected: all focused tests PASS and TypeScript reports no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/pdf/find.ts src/stores/pdf-find-store.ts src/stores/pdf-find-store.test.ts src/components/app/find-option-toggle.tsx src/components/app/pdf-find-bar.tsx src/components/app/pdf-find-bar.test.tsx src/components/app/find-bar.tsx
git commit -m "feat: add PDF find controls"
```

---

### Task 4: Build the typed PDF.js viewer adapter

**Files:**

- Create: `src/lib/pdf/viewer-runtime.ts`
- Create: `src/lib/pdf/viewer-adapter.ts`
- Create: `src/lib/pdf/viewer-adapter.test.ts`
- Create: `src/types/pdfjs-viewer.d.ts`

**Interfaces:**

- Consumes: `PdfFindQuery` and `PdfFindResult` from Task 3.
- Produces: `PdfViewState`, `PdfViewerFailure`, `PdfViewerAdapterOptions`, and `PdfViewerAdapter`.
- Produces: `createPdfViewerAdapter(options): Promise<PdfViewerAdapter>`.
- Produces: `base64ToBytes(value): Uint8Array`.

- [ ] **Step 1: Write failing adapter contract tests**

Use a fake `EventBus` that stores listeners and a fake viewer that emits `pagesinit`, `pagechanging`, and `scalechanging`. Mock `@/lib/pdf/viewer-runtime` so the test never initializes real canvas APIs.

The tests must cover:

```ts
// @vitest-environment happy-dom
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type { PdfFindResult } from "@/lib/pdf/find";
import {
  base64ToBytes,
  createPdfViewerAdapter,
  type PdfViewState,
  type PdfViewerAdapterOptions,
  type PdfViewerFailure,
} from "@/lib/pdf/viewer-adapter";

const runtime = vi.hoisted(() => ({
  getDocument: vi.fn(),
  loadViewerModule: vi.fn(),
}));

vi.mock("@/lib/pdf/viewer-runtime", () => ({
  pdfjsLib: { getDocument: runtime.getDocument },
  loadPdfViewerModule: runtime.loadViewerModule,
}));

describe("PDF viewer adapter", () => {
  beforeEach(() => {
    runtime.getDocument.mockReset();
    runtime.loadViewerModule.mockReset();
  });

  it("decodes base64 bytes without changing byte values", () => {
    expect(Array.from(base64ToBytes("AAECAw=="))).toEqual([0, 1, 2, 3]);
  });

  it("connects viewer services and restores page and scale", async () => {
    const harness = createFakePdfRuntime({ pages: 12 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onReady = vi.fn();
    const onPageChange = vi.fn();
    const onScaleChange = vi.fn();
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(
        onReady,
        onPageChange,
        onScaleChange,
        vi.fn(),
        vi.fn(),
      ),
    );
    await adapter.loadDocument(new Uint8Array([1]), { page: 8, scale: 1.25 });
    expect(harness.linkService.setViewer).toHaveBeenCalledTimes(1);
    expect(harness.viewer.options).toMatchObject({
      eventBus: harness.eventBus,
      linkService: harness.linkService,
      findController: harness.findController,
    });
    expect(harness.viewer.currentPageNumber).toBe(8);
    expect(harness.viewer.currentScale).toBe(1.25);
    expect(onReady).toHaveBeenCalledWith({ page: 8, pageCount: 12, scale: 1.25 });
    harness.eventBus.emit("pagechanging", { pageNumber: 6 });
    harness.eventBus.emit("scalechanging", { scale: 1.5 });
    expect(onPageChange).toHaveBeenCalledWith(6);
    expect(onScaleChange).toHaveBeenCalledWith(1.5);
  });

  it("dispatches complete find, repeat, and close events", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()),
    );
    adapter.search({
      query: "chapter",
      caseSensitive: true,
      wholeWord: true,
    });
    adapter.nextMatch();
    adapter.previousMatch();
    adapter.closeSearch();
    expect(harness.eventBus.dispatch).toHaveBeenNthCalledWith(
      1,
      "find",
      expect.objectContaining({
        type: "",
        query: "chapter",
        caseSensitive: true,
        entireWord: true,
        highlightAll: true,
        findPrevious: false,
      }),
    );
    expect(harness.eventBus.dispatch).toHaveBeenCalledWith(
      "findbarclose",
      expect.any(Object),
    );
  });

  it("maps PDF.js state and progressive count events into strict results", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onFindResult = vi.fn();
    await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), onFindResult, vi.fn()),
    );
    harness.eventBus.emit("updatefindcontrolstate", {
      state: harness.module.FindState.PENDING,
      matchesCount: { current: 0, total: 0 },
    });
    harness.eventBus.emit("updatefindmatchescount", {
      matchesCount: { current: 3, total: 9 },
    });
    expect(onFindResult).toHaveBeenLastCalledWith({
      status: "pending",
      current: 3,
      total: 9,
      error: null,
    });
    harness.eventBus.emit("updatefindcontrolstate", {
      state: harness.module.FindState.FOUND,
      matchesCount: { current: 3, total: 9 },
    });
    expect(onFindResult).toHaveBeenCalledWith({
      status: "found",
      current: 3,
      total: 9,
      error: null,
    });
  });

  it("clears highlights and reports idle state for an empty query", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onFindResult = vi.fn();
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), onFindResult, vi.fn()),
    );
    adapter.search({
      query: "",
      caseSensitive: false,
      wholeWord: false,
    });
    expect(harness.eventBus.dispatch).toHaveBeenCalledWith(
      "findbarclose",
      expect.any(Object),
    );
    expect(onFindResult).toHaveBeenCalledWith({
      status: "idle",
      current: 0,
      total: 0,
      error: null,
    });
  });

  it("ignores a stale document completion after replacement", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    const firstDocument = { numPages: 2 };
    const secondDocument = { numPages: 2 };
    const first = createDeferred<FakePdfDocument>();
    const firstTask: FakeLoadingTask = {
      promise: first.promise,
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    const secondTask: FakeLoadingTask = {
      promise: Promise.resolve(secondDocument),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument
      .mockReturnValueOnce(firstTask)
      .mockReturnValueOnce(secondTask);
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()),
    );
    const staleLoad = adapter.loadDocument(
      new Uint8Array([1]),
      { page: 1, scale: 1 },
    );
    await adapter.loadDocument(
      new Uint8Array([2]),
      { page: 1, scale: 1 },
    );
    first.resolve(firstDocument);
    await staleLoad;
    expect(firstTask.destroy).toHaveBeenCalledTimes(1);
    expect(harness.viewer.setDocument).not.toHaveBeenCalledWith(firstDocument);
    expect(harness.viewer.setDocument).toHaveBeenCalledWith(secondDocument);
  });

  it("reports and rethrows document load failures", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    const error = new Error("Invalid PDF");
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue({
      promise: Promise.reject(error),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
    const onError = vi.fn();
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), vi.fn(), onError),
    );
    await expect(
      adapter.loadDocument(new Uint8Array([1]), { page: 1, scale: 1 }),
    ).rejects.toThrow("Invalid PDF");
    expect(onError).toHaveBeenCalledWith({
      phase: "load",
      message: "Invalid PDF",
      error,
    });
  });

  it("destroys the prior load and detaches listeners on dispose", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()),
    );
    await adapter.loadDocument(new Uint8Array([1]), { page: 1, scale: 1 });
    await adapter.dispose();
    expect(harness.viewer.setDocument).toHaveBeenLastCalledWith(null);
    expect(harness.linkService.setDocument).toHaveBeenLastCalledWith(null, null);
    expect(harness.loadingTask.destroy).toHaveBeenCalledTimes(1);
    expect(harness.eventBus.off).toHaveBeenCalled();
  });
});
```

Define these helpers above the test suite:

```ts
type EventPayload = Record<string, unknown>;
type EventListener = (payload: EventPayload) => void;

class FakeEventBus {
  private readonly listeners = new Map<string, Set<EventListener>>();

  readonly on = vi.fn((name: string, listener: EventListener): void => {
    const listeners = this.listeners.get(name) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  });

  readonly off = vi.fn((name: string, listener: EventListener): void => {
    this.listeners.get(name)?.delete(listener);
  });

  readonly dispatch = vi.fn((name: string, payload: EventPayload): void => {
    this.emit(name, payload);
  });

  emit(name: string, payload: EventPayload): void {
    for (const listener of this.listeners.get(name) ?? []) listener(payload);
  }
}

interface FakePdfDocument {
  numPages: number;
}

interface FakeLoadingTask {
  promise: Promise<FakePdfDocument>;
  destroy: Mock<() => Promise<void>>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred resolver was not initialized");
  };
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createFakePdfRuntime({ pages }: { pages: number }) {
  let eventBus: FakeEventBus | null = null;
  let linkService: FakePDFLinkService | null = null;
  let findController: FakePDFFindController | null = null;
  let viewer: FakePDFViewer | null = null;

  class FakeEventBusConstructor extends FakeEventBus {
    constructor() {
      super();
      eventBus = this;
    }
  }

  class FakePDFLinkService {
    readonly setViewer = vi.fn();
    readonly setDocument = vi.fn();

    constructor(_options: unknown) {
      linkService = this;
    }
  }

  class FakePDFFindController {
    constructor(_options: unknown) {
      findController = this;
    }
  }

  interface FakeViewerOptions {
    eventBus: FakeEventBus;
    linkService: FakePDFLinkService;
    findController: FakePDFFindController;
  }

  class FakePDFViewer {
    currentPageNumber = 1;
    currentScale = 1;
    readonly pagesCount = pages;
    readonly options: FakeViewerOptions;
    readonly setDocument = vi.fn((document: FakePdfDocument | null): void => {
      if (document) eventBus?.emit("pagesinit", {});
    });

    constructor(options: FakeViewerOptions) {
      this.options = options;
      viewer = this;
    }
  }

  const loadingTask: FakeLoadingTask = {
    promise: Promise.resolve({ numPages: pages }),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  const module = {
    EventBus: FakeEventBusConstructor,
    PDFLinkService: FakePDFLinkService,
    PDFFindController: FakePDFFindController,
    PDFViewer: FakePDFViewer,
    FindState: {
      FOUND: 0,
      NOT_FOUND: 1,
      WRAPPED: 2,
      PENDING: 3,
    },
  };

  return {
    module,
    loadingTask,
    get eventBus(): FakeEventBus {
      if (!eventBus) throw new Error("EventBus was not constructed");
      return eventBus;
    },
    get linkService(): FakePDFLinkService {
      if (!linkService) throw new Error("PDFLinkService was not constructed");
      return linkService;
    },
    get findController(): FakePDFFindController {
      if (!findController) throw new Error("PDFFindController was not constructed");
      return findController;
    },
    get viewer(): FakePDFViewer {
      if (!viewer) throw new Error("PDFViewer was not constructed");
      return viewer;
    },
  };
}

function createAdapterOptions(
  onReady: (state: PdfViewState) => void,
  onPageChange: (page: number) => void,
  onScaleChange: (scale: number) => void,
  onFindResult: (result: PdfFindResult) => void,
  onError: (failure: PdfViewerFailure) => void,
): PdfViewerAdapterOptions {
  const container = document.createElement("div");
  const viewer = document.createElement("div");
  container.append(viewer);
  return {
    container,
    viewer,
    onReady,
    onPageChange,
    onScaleChange,
    onFindResult,
    onError,
  };
}
```

The fake viewer's `setDocument` synchronously emits `pagesinit` for a non-null document. Replace `_options` with constructor parameter properties only if TypeScript reports them as unused under the test runner configuration.

- [ ] **Step 2: Run the adapter test to verify it fails**

Run:

```bash
bun x vitest run src/lib/pdf/viewer-adapter.test.ts
```

Expected: FAIL because the runtime and adapter modules do not exist.

- [ ] **Step 3: Add deferred PDF.js viewer-module loading**

Create `viewer-runtime.ts`:

```ts
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type PdfViewerModule = typeof import("pdfjs-dist/web/pdf_viewer.mjs");

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

let viewerModulePromise: Promise<PdfViewerModule> | null = null;

export function loadPdfViewerModule(): Promise<PdfViewerModule> {
  Object.assign(globalThis, { pdfjsLib });
  viewerModulePromise ??= import("pdfjs-dist/web/pdf_viewer.mjs");
  return viewerModulePromise;
}

export { pdfjsLib };
```

The assignment must happen before the dynamic import because the installed viewer bundle reads `globalThis.pdfjsLib` during module evaluation. Do not replace the dynamic import with a static runtime import.

- [ ] **Step 4: Correct the installed viewer's clear-document type**

The PDF.js runtime accepts `null` in `PDFViewer.setDocument`, but its 6.0.227 declaration omits `null`. Add `src/types/pdfjs-viewer.d.ts`:

```ts
import type { PDFDocumentProxy } from "pdfjs-dist";

declare module "pdfjs-dist/web/pdf_viewer.mjs" {
  interface PDFViewer {
    setDocument(pdfDocument: PDFDocumentProxy | null): void;
  }
}
```

This keeps cleanup type-safe without casting around the upstream declaration defect.

- [ ] **Step 5: Define the adapter contract**

Create these public types in `viewer-adapter.ts`:

```ts
import {
  EMPTY_PDF_FIND_RESULT,
  type PdfFindQuery,
  type PdfFindResult,
} from "@/lib/pdf/find";

export interface PdfViewState {
  page: number;
  pageCount: number;
  scale: number;
}

export type PdfViewerPhase = "load" | "initialize" | "search" | "cleanup";

export interface PdfViewerFailure {
  phase: PdfViewerPhase;
  message: string;
  error: unknown;
}

export interface PdfViewerAdapterOptions {
  container: HTMLDivElement;
  viewer: HTMLDivElement;
  onReady: (state: PdfViewState) => void;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: number) => void;
  onFindResult: (result: PdfFindResult) => void;
  onError: (failure: PdfViewerFailure) => void;
}

export interface PdfViewerAdapter {
  loadDocument: (
    data: Uint8Array,
    view: Pick<PdfViewState, "page" | "scale">,
  ) => Promise<void>;
  clearDocument: () => Promise<void>;
  setPage: (page: number) => void;
  setScale: (scale: number) => void;
  search: (query: PdfFindQuery) => void;
  nextMatch: () => void;
  previousMatch: () => void;
  closeSearch: () => void;
  getView: () => PdfViewState;
  dispose: () => Promise<void>;
}
```

- [ ] **Step 6: Implement lifecycle and toolbar synchronization**

`createPdfViewerAdapter` must:

1. Await `loadPdfViewerModule()`.
2. Instantiate one event bus, link service, find controller, and viewer.
3. Pass the explicit `viewer` child to `PDFViewer`.
4. Call `linkService.setViewer(pdfViewer)`.
5. Subscribe named handlers to `pagesinit`, `pagechanging`, `scalechanging`, `updatefindcontrolstate`, and `updatefindmatchescount`.
6. Keep the active loading task and a monotonically increasing load revision.
7. Ignore stale completions after replacement or disposal.

Core construction:

```ts
const module = await loadPdfViewerModule();
const eventBus = new module.EventBus();
const linkService = new module.PDFLinkService({ eventBus });
const findController = new module.PDFFindController({
  eventBus,
  linkService,
});
const pdfViewer = new module.PDFViewer({
  container: options.container,
  viewer: options.viewer,
  eventBus,
  linkService,
  findController,
});
linkService.setViewer(pdfViewer);
```

`loadDocument` must clear the previous document, call `pdfjsLib.getDocument({ data })`, await its promise, attach the new document to the viewer and link service, then apply the requested page and scale from the `pagesinit` handler.

Clamp page with `clamp(page, 1, pdfViewer.pagesCount)` from `es-toolkit`.

- [ ] **Step 7: Implement PDF.js find event translation**

Store the latest `PdfFindQuery`. Dispatch:

```ts
eventBus.dispatch("find", {
  source: adapterSource,
  type: "",
  query: request.query,
  caseSensitive: request.caseSensitive,
  entireWord: request.wholeWord,
  highlightAll: true,
  findPrevious: false,
  matchDiacritics: false,
});
```

If `request.query` is empty, dispatch `findbarclose`, publish `EMPTY_PDF_FIND_RESULT`, and do not dispatch `find`. Make next and previous no-ops while the latest query is empty.

For next and previous, dispatch the same complete state with `type: "again"` and the appropriate `findPrevious` value. Close with:

```ts
eventBus.dispatch("findbarclose", { source: adapterSource });
```

Maintain the latest mapped status and `{ current, total }` count inside the adapter. `updatefindcontrolstate` replaces the mapped status and accepts its supplied count. `updatefindmatchescount` replaces only the count and republishes the current status so progress appears while status is pending. Map `module.FindState.FOUND`, `NOT_FOUND`, `WRAPPED`, and `PENDING` to the matching `PdfFindStatus`. Unknown states are explicit search failures.

- [ ] **Step 8: Implement explicit error and cleanup behavior**

Normalize errors without guessing:

```ts
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportFailure(
  options: PdfViewerAdapterOptions,
  phase: PdfViewerPhase,
  error: unknown,
): void {
  const failure: PdfViewerFailure = {
    phase,
    message: errorMessage(error),
    error,
  };
  console.error("[pdf-viewer]", { phase, error });
  options.onError(failure);
}
```

`createPdfViewerAdapter` reports initialization failures and rethrows them. `loadDocument` reports current-revision load failures and rethrows them, but resolves without reporting when an obsolete load is cancelled by replacement or disposal. `clearDocument` must set viewer and link-service documents to null before destroying the active loading task. `dispose` must mark the adapter disposed, increment the load revision, remove every named event handler with `off`, clear the document, and report rejected cleanup.

- [ ] **Step 9: Run adapter tests and type checking**

Run:

```bash
bun x vitest run src/lib/pdf/viewer-adapter.test.ts
just typecheck
```

Expected: adapter tests PASS and TypeScript reports no errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/pdf/viewer-runtime.ts src/lib/pdf/viewer-adapter.ts src/lib/pdf/viewer-adapter.test.ts src/types/pdfjs-viewer.d.ts
git commit -m "feat: add PDF.js viewer adapter"
```

---

### Task 5: Replace the custom PDF page stack

**Files:**

- Create: `src/components/app/pdf-pane.test.tsx`
- Modify: `src/components/app/pdf-pane.tsx:1-476`
- Modify: `src/index.css:1-6, 21-174, 275-287`

**Interfaces:**

- Consumes: `createPdfViewerAdapter`, `PdfViewerAdapter`, and `PdfViewerFailure` from Task 4.
- Consumes: existing `useProjectStore`, `useSettingsStore`, and `useViewStore`.
- Produces: the same exported `PdfPane()` component.

- [ ] **Step 1: Write failing PDF pane lifecycle tests**

Mock the adapter factory and seed only the project, compile, settings, and view state used by `PdfPane`.

Required test cases:

```tsx
// @vitest-environment happy-dom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfPane } from "@/components/app/pdf-pane";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ProjectInfo } from "@/lib/types";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";

const adapter = vi.hoisted(() => ({
  loadDocument: vi.fn(),
  clearDocument: vi.fn(),
  setPage: vi.fn(),
  setScale: vi.fn(),
  search: vi.fn(),
  nextMatch: vi.fn(),
  previousMatch: vi.fn(),
  closeSearch: vi.fn(),
  getView: vi.fn(() => ({ page: 1, pageCount: 4, scale: 1.1 })),
  dispose: vi.fn(),
}));

const viewerCallbacks = vi.hoisted(() => ({
  onPageChange: null as ((page: number) => void) | null,
}));

vi.mock("@/lib/pdf/viewer-adapter", () => ({
  base64ToBytes: vi.fn(() => new Uint8Array([1])),
  createPdfViewerAdapter: vi.fn(async (options: {
    onReady: (state: { page: number; pageCount: number; scale: number }) => void;
    onPageChange: (page: number) => void;
  }) => {
    viewerCallbacks.onPageChange = options.onPageChange;
    options.onReady({ page: 1, pageCount: 4, scale: 1.1 });
    return adapter;
  }),
}));

vi.mock("@/lib/tauri", () => ({
  pdfPath: vi.fn().mockResolvedValue("/books/preview.pdf"),
}));

function renderPane(): RenderResult {
  return render(
    <TooltipProvider>
      <PdfPane />
    </TooltipProvider>,
  );
}

const project: ProjectInfo = {
  root: "/books",
  name: "Book",
  mainFile: "main.tex",
  title: "Book",
  author: "Author",
  metadata: {
    title: "Book",
    subtitle: "",
    author: "Author",
    publisher: "",
    isbn: "",
  },
  chapters: [],
};

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  viewerCallbacks.onPageChange = null;
  adapter.loadDocument.mockResolvedValue(undefined);
  adapter.clearDocument.mockResolvedValue(undefined);
  adapter.dispose.mockResolvedValue(undefined);
  useSettingsStore.setState({ pdfZoom: 1.1 });
  useProjectStore.setState({
    project,
    compile: {
      status: "clean",
      pdfBase64: "AQ==",
      at: 1,
      durationMs: 100,
      log: "",
      errors: [],
    },
  });
});

describe("PdfPane viewer lifecycle", () => {
  it("loads compiled bytes at the persisted zoom", async () => {
    renderPane();
    await waitFor(() =>
      expect(adapter.loadDocument).toHaveBeenCalledWith(
        new Uint8Array([1]),
        { page: 1, scale: 1.1 },
      ),
    );
  });

  it("preserves the current page when compiled bytes are replaced", async () => {
    renderPane();
    await waitFor(() => expect(adapter.loadDocument).toHaveBeenCalledTimes(1));
    act(() => viewerCallbacks.onPageChange?.(3));
    act(() => {
      useProjectStore.setState((state) => ({
        compile: {
          status: state.compile.status,
          pdfBase64: "Ag==",
          log: state.compile.log,
          errors: state.compile.errors,
          durationMs: state.compile.durationMs,
          at: 2,
        },
      }));
    });
    await waitFor(() =>
      expect(adapter.loadDocument).toHaveBeenLastCalledWith(
        new Uint8Array([1]),
        { page: 3, scale: 1.1 },
      ),
    );
  });

  it("shows an explicit viewer error and keeps recompile available", async () => {
    adapter.loadDocument.mockRejectedValueOnce(new Error("Invalid PDF"));
    renderPane();
    expect(await screen.findByText("Invalid PDF")).toBeTruthy();
    expect(screen.getByTitle("Re-compile")).toBeTruthy();
  });

  it("disposes the adapter on unmount", async () => {
    const view = renderPane();
    await waitFor(() => expect(adapter.loadDocument).toHaveBeenCalled());
    view.unmount();
    await waitFor(() => expect(adapter.dispose).toHaveBeenCalledTimes(1));
  });
});
```

Use the complete project and compile shapes shown above rather than weakening production types.

- [ ] **Step 2: Run the PDF pane test to verify it fails**

Run:

```bash
bun x vitest run src/components/app/pdf-pane.test.tsx
```

Expected: FAIL because `PdfPane` still owns the custom canvas stack and does not create the adapter.

- [ ] **Step 3: Import official PDF.js viewer CSS and add scoped overrides**

At the top of `index.css`, before Tailwind:

```css
@import "pdfjs-dist/web/pdf_viewer.css" layer(pdfjs);
@import "tailwindcss";
```

Keep all existing imports after those lines. Reassert application color scheme after the layered PDF.js `:root` rule:

```css
:root {
  color-scheme: light;
}

.dark,
[data-theme="dark"] {
  color-scheme: dark;
}
```

Add scoped viewer rules in `@layer utilities`:

```css
.aproprose-pdf-viewer {
  --pdfViewer-padding-bottom: 1rem;
  --page-margin: 1rem auto 0;
  --page-border: 1px solid var(--border);
  --page-bg-color: var(--sheet);
}

.aproprose-pdf-viewer .page {
  border-radius: 2px;
  box-shadow: 0 10px 15px -3px color-mix(in oklch, var(--foreground) 12%, transparent);
  overflow: hidden;
}

.aproprose-pdf-viewer .textLayer .highlight {
  --highlight-bg-color: color-mix(in oklch, var(--accent-ink) 22%, transparent);
  --highlight-selected-bg-color: color-mix(
    in oklch,
    var(--accent-ink) 42%,
    transparent
  );
}
```

These are required because PDF.js creates page and highlight nodes outside React, so Tailwind classes cannot be attached to those generated elements.

- [ ] **Step 4: Replace manual page rendering with adapter refs**

Delete:

- `PdfPageView`.
- `PageSize`.
- Intersection observers and ratio tracking.
- Manual canvas render tasks.
- Manual page wrapper sizing.
- Manual scroll-to-page geometry.

Keep:

- Page and zoom text editing behavior.
- Copy-path resolution and copy state.
- Compile state and recompile action.
- Current page and total page state.

Add:

```ts
const containerRef = useRef<HTMLDivElement>(null);
const viewerRef = useRef<HTMLDivElement>(null);
const adapterRef = useRef<PdfViewerAdapter | null>(null);
const [adapterRevision, setAdapterRevision] = useState(0);
const [documentRevision, setDocumentRevision] = useState(0);
const [numPages, setNumPages] = useState(0);
const [current, setCurrent] = useState(1);
const [viewerError, setViewerError] = useState<string | null>(null);
const hasDocumentRef = useRef(false);
const currentRef = useRef(1);
currentRef.current = current;
```

Create the adapter once after both DOM refs exist. Callbacks must:

- Update page, page count, and scale from `onReady`.
- Update current page from `onPageChange`.
- Persist valid scale changes through `setPdfZoom`.
- Forward find results into `usePdfFindStore.getState().setResult`.
- Route search-phase failures to the PDF find store and other failures to `viewerError`.

- [ ] **Step 5: Load, replace, clear, and dispose documents**

When `pdfBase64` is null:

```ts
hasDocumentRef.current = false;
setNumPages(0);
setCurrent(1);
usePdfFindStore.getState().resetMatches();
void adapter.clearDocument();
```

When bytes exist, call:

```ts
const targetPage = hasDocumentRef.current ? currentRef.current : 1;
hasDocumentRef.current = false;
await adapter.loadDocument(base64ToBytes(pdfBase64), {
  page: targetPage,
  scale,
});
hasDocumentRef.current = true;
setDocumentRevision((revision) => revision + 1);
```

Use an effect-local cancellation flag so stale async completions cannot change React state. On unmount, call `dispose()` and log any rejected cleanup with:

```ts
console.error("[pdf-viewer]", { phase: "cleanup", error });
```

- [ ] **Step 6: Connect toolbar controls to the adapter**

- Page commit calls `adapterRef.current?.setPage(parsedPage)`.
- Zoom commit and buttons call both `setPdfZoom(clampedScale)` and `adapterRef.current?.setScale(clampedScale)`.
- PDF.js page/scale callbacks update the fields without redispatching when the value is already current.
- Recompile and close keep their existing store actions.

Render the viewer DOM as:

```tsx
<div className="relative min-h-0 flex-1">
  <div
    ref={containerRef}
    className="absolute inset-0 overflow-auto bg-muted"
    aria-label="PDF pages"
  >
    <div ref={viewerRef} className="pdfViewer aproprose-pdf-viewer" />
  </div>
</div>
```

Overlay the existing compiling, empty, or explicit error state only when no usable document is showing. Use `Alert`, `AlertTitle`, `AlertDescription`, and `TypographyMuted`; do not introduce raw paragraph typography.

- [ ] **Step 7: Run PDF pane, adapter, and build checks**

Run:

```bash
bun x vitest run src/components/app/pdf-pane.test.tsx src/lib/pdf/viewer-adapter.test.ts
just typecheck
just build
```

Expected: focused tests PASS, type checking passes, and Vite resolves both `pdf_viewer.mjs` and layered `pdf_viewer.css`.

- [ ] **Step 8: Commit**

```bash
git add src/components/app/pdf-pane.tsx src/components/app/pdf-pane.test.tsx src/index.css
git commit -m "refactor: render PDFs with the PDF.js viewer"
```

---

### Task 6: Wire PDF search, active state, and copy tooltip

**Files:**

- Modify: `src/components/app/pdf-pane.tsx`
- Modify: `src/components/app/pdf-pane.test.tsx`

**Interfaces:**

- Consumes: `PdfFindBar` from Task 3.
- Consumes: `PdfViewerAdapter` search methods from Task 4.
- Consumes: `useSearchSurfaceStore` and `usePdfFindStore`.
- Produces: completed PDF search interaction and active-state feedback.

- [ ] **Step 1: Extend failing PDF pane tests**

Add these tests to `pdf-pane.test.tsx`:

```tsx
it("activates PDF search and styles the filename on pointer interaction", async () => {
  renderPane();
  const pane = screen.getByLabelText("PDF preview");
  fireEvent.pointerDown(pane);
  expect(useSearchSurfaceStore.getState().activeSurface).toBe("pdf");
  expect(screen.getByText("preview.pdf").className).toContain("text-accent-ink");
  expect(screen.getByText("preview.pdf").className).toContain("font-medium");
});

it("searches with the retained PDF query while PDF find is open", async () => {
  renderPane();
  await waitFor(() => expect(adapter.loadDocument).toHaveBeenCalled());
  usePdfFindStore.setState({
    query: "Chapter Nine",
    caseSensitive: false,
    wholeWord: true,
  });
  useSearchSurfaceStore.setState({
    activeSurface: "pdf",
    openSurface: "pdf",
    focusRevision: 1,
  });
  await waitFor(() =>
    expect(adapter.search).toHaveBeenCalledWith({
      query: "Chapter Nine",
      caseSensitive: false,
      wholeWord: true,
    }),
  );
});

it("closes PDF.js search when another find surface opens", async () => {
  renderPane();
  useSearchSurfaceStore.setState({ openSurface: "pdf" });
  useSearchSurfaceStore.setState({ openSurface: "editor" });
  await waitFor(() => expect(adapter.closeSearch).toHaveBeenCalled());
});

it("shows a copy-path tooltip and copied accessible label", async () => {
  renderPane();
  const copy = await screen.findByRole("button", { name: "Copy PDF path" });
  fireEvent.pointerMove(copy);
  expect(await screen.findByText("Copy PDF path")).toBeTruthy();
  fireEvent.click(copy);
  expect(await screen.findByRole("button", { name: "Copied PDF path" })).toBeTruthy();
});
```

Add the required imports for `fireEvent`, `usePdfFindStore`, and `useSearchSurfaceStore`. Mock `copyText` to resolve `true`. Reset both stores in `beforeEach`.

- [ ] **Step 2: Run the PDF pane test to verify new cases fail**

Run:

```bash
bun x vitest run src/components/app/pdf-pane.test.tsx
```

Expected: new tests FAIL because search effects, active styling, and tooltip are not wired.

- [ ] **Step 3: Add PDF activation and accessible state**

Subscribe to:

```ts
const activeSurface = useSearchSurfaceStore((state) => state.activeSurface);
const activateSearchSurface = useSearchSurfaceStore((state) => state.activate);
const pdfActive = activeSurface === "pdf";
```

Apply to the `<aside>`:

```tsx
<aside
  aria-label={pdfActive ? "PDF preview, active search surface" : "PDF preview"}
  data-search-surface="pdf"
  onPointerDownCapture={() => activateSearchSurface("pdf")}
  onFocusCapture={() => activateSearchSurface("pdf")}
  className="flex h-full min-h-0 flex-col bg-muted"
>
```

Style the filename with `cn`:

```tsx
className={cn(
  "font-mono text-xs",
  pdfActive ? "font-medium text-accent-ink" : "text-muted-foreground",
)}
```

- [ ] **Step 4: Add the copy-path tooltip**

Replace the native dynamic `title` with:

```tsx
const copyLabel = copied ? "Copied PDF path" : "Copy PDF path";

<Tooltip>
  <TooltipTrigger asChild>
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={copyLabel}
      onClick={() => void copyPath()}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </Button>
  </TooltipTrigger>
  <TooltipContent>{copyLabel}</TooltipContent>
</Tooltip>
```

Do not place the full filesystem path in the tooltip.

- [ ] **Step 5: Mount `PdfFindBar` and drive adapter search**

Render `PdfFindBar` as a positioned sibling above the viewer container:

```tsx
<PdfFindBar
  onNext={() => adapterRef.current?.nextMatch()}
  onPrevious={() => adapterRef.current?.previousMatch()}
/>
```

Subscribe to `openSurface`, PDF query, and options. Add one effect:

```ts
useEffect(() => {
  const adapter = adapterRef.current;
  if (!adapter) return;
  if (openSurface !== "pdf") {
    adapter.closeSearch();
    return;
  }
  adapter.search({ query, caseSensitive, wholeWord });
}, [
  adapterRevision,
  documentRevision,
  openSurface,
  query,
  caseSensitive,
  wholeWord,
]);
```

Before loading replacement bytes, call `resetMatches()`. The incremented `documentRevision` reruns an open non-empty query against the new document.

- [ ] **Step 6: Run all feature tests and type checking**

Run:

```bash
bun x vitest run src/stores/search-surface-store.test.ts src/components/app/search-coordinator.test.tsx src/components/app/find-bar.test.tsx src/components/app/editor.delete-block.test.tsx src/stores/pdf-find-store.test.ts src/components/app/pdf-find-bar.test.tsx src/lib/pdf/viewer-adapter.test.ts src/components/app/pdf-pane.test.tsx src/stores/find-store.test.ts src/lib/keybindings.test.ts
just typecheck
```

Expected: all feature tests PASS and TypeScript reports no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/app/pdf-pane.tsx src/components/app/pdf-pane.test.tsx
git commit -m "feat: search compiled PDFs"
```

---

### Task 7: Verify the real PDF.js integration and complete the quality gate

**Files:**

- Modify only files required by failures found in this task.

**Interfaces:**

- Consumes the completed feature from Tasks 1-6.
- Produces a verified browser bundle and native Tauri interaction.

- [ ] **Step 1: Run the full frontend test suite**

Run:

```bash
bun x vitest run
```

Expected: every frontend and script test PASS.

- [ ] **Step 2: Run the project quality gates**

Run:

```bash
just typecheck
just build
```

Expected: both commands exit 0. Confirm the production bundle contains the PDF.js viewer and worker chunks without unresolved-module warnings.

- [ ] **Step 3: Exercise the browser preview**

Run:

```bash
just dev
```

Use Playwright against `http://localhost:1420` and verify:

1. Opening the PDF pane leaves editor search active until the PDF is clicked.
2. Clicking the PDF changes `preview.pdf` to the active classes.
3. Cmd/Ctrl+F opens only the PDF find bar.
4. Enter and Shift+Enter call opposite navigation directions.
5. Clicking the editor routes the next Cmd/Ctrl+F to editor find-and-replace.
6. Hovering the copy icon shows "Copy PDF path".

If browser preview cannot load native project data, complete rendering and compiled-document checks in Step 4 rather than creating a fallback data path.

- [ ] **Step 4: Exercise a real compiled manuscript in Tauri**

Run:

```bash
just run
```

Open a compiled manuscript containing a repeated chapter title and verify:

1. Search reaches a match on a page outside the initial viewport.
2. PDF.js scrolls the selected exact highlight into view.
3. Match case and whole word alter results.
4. Match count progresses and settles on the final count.
5. Previous and next wrap through repeated matches.
6. Escape closes search and removes highlights.
7. Text remains selectable in the PDF text layer.
8. Zoom and page fields remain synchronized.
9. Recompile preserves the valid page and persisted zoom.
10. PDF load or search errors render explicit inline messages.

- [ ] **Step 5: Fix any failures with a focused regression test**

For every failure:

1. Add a failing test to the closest existing feature test file.
2. Run that single test and confirm the observed failure.
3. Make the minimum architecturally correct change.
4. Run the focused test and the full feature test list from Task 6.

Do not add fallback PDF search, OCR, regex, stock viewer chrome, or unrelated refactors.

- [ ] **Step 6: Commit verification fixes if any**

If Step 5 changed files:

```bash
git add src
git commit -m "fix: harden PDF search integration"
```

If Step 5 changed nothing, do not create an empty commit.

- [ ] **Step 7: Confirm final repository state**

Run:

```bash
git status --short
git log --oneline origin/main..HEAD
```

Expected: the worktree is clean and the branch contains the independent commits from Tasks 1-6 plus any focused verification fix.
