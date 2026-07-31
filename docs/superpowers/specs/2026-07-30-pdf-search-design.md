# PDF Search Design

Status: Approved

Date: 2026-07-30

## Summary

Aproprose will use the official PDF.js viewer engine inside the existing PDF pane. The app will retain its React toolbar and visual design while PDF.js takes responsibility for page rendering, text layers, full-document search, match highlighting, and match navigation.

Cmd/Ctrl+F will target the last clicked or focused primary pane. Clicking or focusing the PDF pane makes PDF search active. Clicking or focusing the editor restores editor search. The PDF filename provides a quiet active-state indicator, and the existing copy-path button gains an explanatory tooltip.

## Goals

- Search the full compiled PDF, including pages that have not yet rendered.
- Highlight the exact selected match and scroll it into view.
- Navigate matches forward and backward with keyboard and pointer controls.
- Route Cmd/Ctrl+F deterministically between the editor and PDF pane.
- Preserve independent editor and PDF queries.
- Preserve the current PDF toolbar, zoom preference, page navigation, recompile behavior, and reading position.
- Explain the copy-path control with the shared tooltip primitive.
- Continue to work in Tauri webviews without relying on a native browser PDF viewer.

## Non-goals

- Replacing text inside a PDF.
- Regular-expression PDF search.
- OCR for scanned or image-only pages.
- Embedding the stock PDF.js toolbar or standalone viewer application.
- Adding annotation editing, printing, downloading, or other PDF viewer features.
- Changing editor find-and-replace matching behavior.
- Persisting the active search surface or PDF query across application restarts.

## Current State

`src/components/app/pdf-pane.tsx` loads compiled PDF bytes with `pdfjs-dist` and renders each page into a lazy canvas. The canvas has no searchable DOM text, so native browser find cannot see the rendered manuscript.

Editor find-and-replace is implemented by `FindBar`, `useFindStore`, and the pure block matcher. `Editor` currently owns the only `OPEN_FIND` keybinding, so Cmd/Ctrl+F always targets editor content.

The existing PDF pane already owns the desired application chrome:

- Compiled filename and copy-path button.
- Compile status and recompile action.
- Current page field.
- Zoom controls backed by the settings store.
- Close action.
- Reading-position restoration after recompile.

## Decision

Use the public viewer components exported by `pdfjs-dist/web/pdf_viewer.mjs`:

- `PDFViewer`
- `PDFFindController`
- `EventBus`
- `PDFLinkService`

The viewer receives the same `PDFDocumentProxy` created from compiled bytes today. It replaces only the hand-built page stack. Aproprose continues to own the React toolbar and supplies a custom React find bar that communicates with `PDFFindController` through `EventBus`.

This avoids maintaining custom text normalization, text-item offset mapping, highlight geometry, progressive extraction, and selected-match scrolling. It also retains PDF.js lazy rendering instead of eagerly painting every manuscript page.

## Search Surface State

Add a non-persisted search-surface concern with two values:

```ts
type SearchSurface = "editor" | "pdf";
```

The shared state records:

- The active search surface.
- The currently open find surface, or `null`.
- A focus revision that lets repeated Cmd/Ctrl+F focus and select the active query.

The editor is the default active surface. Opening or closing the PDF pane does not persist a new default. If the active PDF pane unmounts or becomes unavailable, the active surface returns to the editor.

The state belongs in a Zustand store because the workspace router, editor, PDF pane, and both find bars read or write it.

## Activation Rules

- A pointer press anywhere in the PDF pane activates PDF search.
- Focus entering any PDF toolbar or find control activates PDF search.
- A pointer press anywhere in the editor activates editor search.
- Focus entering an editable block or editor find control activates editor search.
- Hover never changes the active surface.
- Interacting with the AI panel does not change the last active editor or PDF surface.

Pane roots use capture-phase pointer and focus handlers so child buttons and inputs cannot bypass activation.

## Keybinding Routing

`OPEN_FIND` remains the single registry entry for Cmd/Ctrl+F. Its description changes to "Find in the active pane".

A workspace-level search coordinator owns the cross-pane action:

1. Read the active search surface.
2. Open that surface's find bar.
3. Close the other surface's find bar while retaining its query and options.
4. Increment the focus revision so an already-open bar refocuses and selects its query.

The editor keeps its existing matcher, replacement behavior, and option state. Only ownership of the global open/close state and shortcut routing changes.

## PDF Find Bar

The PDF find bar follows the existing editor find bar's visual language and uses the same UI primitives. It appears at the top-right of the PDF viewport below the pane toolbar.

It contains:

- Search input.
- Current match and total match count.
- Match-case toggle.
- Whole-word toggle.
- Previous-match button.
- Next-match button.
- Close button.

It does not contain replacement controls or a regular-expression toggle.

Behavior:

- Opening the bar focuses and selects the retained PDF query.
- Query or option changes initiate a full-document PDF.js search.
- Enter selects the next match.
- Shift+Enter selects the previous match.
- Escape closes PDF search and removes PDF highlights.
- Navigation wraps according to PDF.js behavior.
- An empty query shows no counter and no highlights.
- A completed search with no matches shows "No results".
- Pending search state uses the shared `Spinner` without loading punctuation.
- PDF.js progress events update the counter while pages are indexed, followed by the final total.

The PDF query, supported options, match count, selected-match number, pending state, and error state live in a dedicated non-persisted PDF find store. They are independent from editor find state and survive closing and reopening the PDF pane during the current application session.

Loading a new PDF clears match-derived state while retaining the query and options. If PDF search is open with a non-empty query after the new viewer initializes, the adapter runs that query against the new document.

## PDF.js Search Contract

The integration translates React find-bar actions into PDF.js event-bus commands:

- Query and option changes dispatch a find request with the complete current search state.
- Next and previous dispatch repeated-find requests with the requested direction.
- Closing dispatches the PDF.js find-bar-close event.

The integration subscribes to PDF.js find-control-state and match-count events to update:

- Pending, found, not-found, and wrapped state.
- Current selected match number.
- Total match count.

PDF.js owns text extraction, normalization, text-layer highlighting, selected-match tracking, and scrolling the selected highlight into view.

## Viewer Lifecycle

The PDF viewer surface owns DOM refs and the PDF.js viewer objects. For each mounted surface:

1. Create one `EventBus`.
2. Create one `PDFLinkService`.
3. Create one `PDFFindController`.
4. Create one `PDFViewer` attached to the scroll container and viewer child.
5. Connect the link service, find controller, and viewer.

When compiled bytes produce a new `PDFDocumentProxy`:

1. Capture the currently visible page if an existing document is loaded.
2. Detach and destroy the previous loading task and document resources.
3. Assign the new document to the viewer, link service, and find controller.
4. Reapply the stored zoom.
5. Restore the captured page after the new viewer initializes, clamped to the new page count.
6. Re-run an open, non-empty PDF query against the new document.

On project switches and first loads, the viewer starts at page 1. On component unmount, event subscriptions, loading tasks, documents, and viewer resources are explicitly cleaned up.

The official `pdf_viewer.css` supplies text-layer and viewer layout behavior. Aproprose adds only the scoped token-based overrides needed to preserve its paper, border, spacing, and shadow appearance.

## Toolbar Synchronization

The existing toolbar remains React-controlled:

- PDF.js page-change events update the current page input.
- Committing the page input sets the viewer's current page.
- Zoom buttons and the zoom input update the persisted PDF zoom setting and viewer scale.
- PDF.js scale-change events keep the displayed percentage synchronized.
- Recompile continues to call the existing project-store action.
- Close continues to use the existing view-store action.
- Copy path continues to resolve through the existing Rust command.

Updates must avoid feedback loops between PDF.js events, React state, and the settings store.

## Active PDF Indicator

The filename is the only persistent visual indicator:

- Inactive: existing muted text.
- Active: accent ink color and medium weight.

The pane does not gain a focus border, status dot, or background treatment. The PDF pane also exposes an accessible label that communicates when it is the active search surface.

## Copy-path Tooltip

Wrap the existing copy-path button with the shared `Tooltip`, `TooltipTrigger`, and `TooltipContent` primitives.

- Default tooltip and accessible label: "Copy PDF path".
- Successful-copy tooltip and accessible label: "Copied PDF path".
- Copy failures continue to use the existing explicit error toast.
- The tooltip does not display the full path.

## Error Handling

- PDF load or viewer initialization failures replace the preview with an explicit inline error state and preserve the recompile action.
- Search integration failures produce an inline "Search unavailable" state and disable match navigation.
- Viewer and search errors are logged with structured `phase` and `error` fields while the inline state shows the underlying actionable message.
- Rejected asynchronous cleanup operations are logged with structured `phase` and `error` fields.
- Image-only pages legitimately produce no text matches. No OCR fallback is attempted.
- The app does not fall back to a second custom PDF search implementation.

## Accessibility

- The search input has an explicit accessible label.
- Previous, next, close, option toggles, and copy path retain explicit accessible names.
- Match state is exposed as text, not color alone.
- The active PDF filename changes weight as well as color.
- Keyboard behavior matches the editor find bar.
- PDF.js text layers retain text selection and assistive-technology access.

## Testing Strategy

### Pure state tests

- Editor is the default active surface.
- Pointer or focus activation switches surfaces.
- Opening find targets the active surface and closes the other surface.
- Repeated open increments focus state.
- PDF unavailability restores editor activation.
- Editor and PDF queries remain independent.

### Component tests

- Cmd/Ctrl+F routes to editor search after editor activation.
- Cmd/Ctrl+F routes to PDF search after PDF activation.
- Active PDF filename uses the active classes and inactive filename does not.
- Copy-path tooltip and accessible labels reflect idle and copied states.
- PDF find input handles Enter, Shift+Enter, and Escape.
- PDF find controls dispatch the expected adapter actions.
- Match-count and pending events render the correct counter or spinner.
- Search errors disable navigation and remain visible.

### PDF adapter tests

- Viewer, link service, and find controller are connected once per mounted surface.
- A new document is assigned to every required PDF.js component.
- Page and scale events synchronize React state.
- Recompile restores a clamped page number and stored zoom.
- Document replacement and unmount remove event listeners and destroy resources.
- Adapter errors reach the explicit UI error state.

### Verification

- Run the focused Vitest suites.
- Run `just typecheck`.
- Run `just build`.
- Exercise a real compiled manuscript in the browser preview and the Tauri app:
  - Search for a chapter title on a distant page.
  - Confirm exact highlighting and automatic scrolling.
  - Navigate forward and backward through repeated text.
  - Switch between editor and PDF search with pointer activation.
  - Recompile and verify page and zoom restoration.
  - Hover and activate the copy-path control.

## Acceptance Criteria

- Clicking or focusing the PDF pane visibly activates `preview.pdf`.
- Cmd/Ctrl+F opens PDF search while PDF is active.
- Clicking or focusing the editor routes the next Cmd/Ctrl+F back to editor find-and-replace.
- At most one find bar is open, but each surface retains its own query.
- PDF search covers the complete document and highlights the selected exact match.
- Enter, Shift+Enter, previous, and next navigate matches and scroll them into view.
- Match case and whole word work through PDF.js.
- Closing PDF search removes its highlights.
- Page input, zoom, compile, close, and copy-path behavior continue to work.
- Recompile keeps the reader on the same valid page at the persisted zoom.
- The copy-path button explains itself through a shared tooltip.
- Load, initialization, and search failures are visible and actionable.
- Type checking, tests, and the production frontend build pass.
