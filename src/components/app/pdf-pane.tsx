// pdf-pane.tsx — a REAL compiled-PDF preview.
//
// The prototype faked a typeset page; here we render the actual latexmk output
// with pdf.js to a canvas (WebKitGTK has no built-in PDF viewer, so an <iframe>
// won't do). Every page is stacked in one scrollable column so the writer reads
// by scrolling; a typed page field jumps to any page. Pages render lazily (only
// those near the viewport paint to a canvas) to keep a long manuscript light.
// Zoom is a typed, persisted percentage, and the reading position is kept across
// re-compiles. PDF bytes arrive base64-encoded from the Rust
// `compile_project`/`read_pdf` commands.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clamp } from "es-toolkit";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  IconMinus,
  IconPlayerPlayFilled,
  IconPlus,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type PdfDoc = Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;
interface CancellableRender {
  promise: Promise<void>;
  cancel: () => void;
}
/** Unscaled page dimensions (CSS px at 100% zoom), used to size the page boxes. */
interface PageSize {
  width: number;
  height: number;
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.1;
/** Render pages within this many px above/below the viewport, not just visible ones. */
const RENDER_MARGIN_PX = 400;
/** The scroll column's top padding (Tailwind p-4); kept above a page when scrolling to it. */
const SCROLL_TOP_PADDING_PX = 16;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function clampZoom(z: number): number {
  return clamp(Math.round(z * 100) / 100, ZOOM_MIN, ZOOM_MAX);
}

// One page in the scroll column. The wrapper is sized synchronously from the
// document's page size (so the column has correct height and the scrollbar is
// right before anything paints); the canvas only mounts and renders while the
// page is near the viewport, keeping a long document cheap.
function PdfPageView({
  doc,
  pageNumber,
  scale,
  baseSize,
  root,
}: {
  doc: PdfDoc;
  pageNumber: number;
  scale: number;
  baseSize: PageSize;
  root: HTMLElement | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Paint the first pages immediately; the observer corrects the rest on mount.
  const [visible, setVisible] = useState(pageNumber <= 3);

  // Size the page box before paint, from the known page size — no async gap, so
  // the box never collapses to 0×0 and the canvas can't desync from it on zoom.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.style.width = `${Math.round(baseSize.width * scale)}px`;
    el.style.height = `${Math.round(baseSize.height * scale)}px`;
  }, [baseSize, scale]);

  // Track whether the page is near the viewport.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { root, rootMargin: `${RENDER_MARGIN_PX}px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  // Render the page at the current zoom while it is near the viewport.
  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let task: CancellableRender | null = null;
    void doc
      .getPage(pageNumber)
      .then((p) => {
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const viewport = p.getViewport({ scale: scale * dpr });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        task = p.render({
          canvas,
          canvasContext: ctx,
          viewport,
        }) as unknown as CancellableRender;
        task.promise.catch(() => {
          /* cancelled renders reject — ignore */
        });
      })
      .catch(() => {
        /* page fetch failed — leave the sized placeholder in place */
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, doc, pageNumber, scale]);

  return (
    <div
      ref={wrapRef}
      data-page={pageNumber}
      className="mx-auto overflow-hidden rounded-[2px] border border-border bg-card shadow-lg"
    >
      {visible ? <canvas ref={canvasRef} className="block h-full w-full" /> : null}
    </div>
  );
}

export function PdfPane() {
  const pdfBase64 = useProjectStore((s) => s.compile.pdfBase64);
  const status = useProjectStore((s) => s.compile.status);
  const at = useProjectStore((s) => s.compile.at);
  const durationMs = useProjectStore((s) => s.compile.durationMs);
  const compileNow = useProjectStore((s) => s.compileNow);
  const closePdf = useViewStore((s) => s.togglePdf);
  const scale = useSettingsStore((s) => s.pdfZoom);
  const setPdfZoom = useSettingsStore((s) => s.setPdfZoom);

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [baseSize, setBaseSize] = useState<PageSize | null>(null);
  const [current, setCurrent] = useState(1);
  const ratios = useRef<Map<number, number>>(new Map());

  // Latest values mirrored into refs so the byte-loading effect (which only
  // re-runs on new bytes) can read them without widening its dependencies.
  const docRef = useRef<PdfDoc | null>(null);
  docRef.current = doc;
  const currentRef = useRef(1);
  currentRef.current = current;
  // Page to scroll to once the next document mounts (set on re-compile to keep
  // the reader's place); null once consumed.
  const restorePageRef = useRef<number | null>(null);

  // Scroll the column so page n sits at the top of the viewport.
  const scrollToPage = (n: number) => {
    if (!scrollEl) return;
    const max = doc?.numPages ?? 1;
    const clamped = clamp(n, 1, max);
    const el = scrollEl.querySelector<HTMLElement>(`[data-page="${clamped}"]`);
    if (!el) return;
    const top =
      el.getBoundingClientRect().top -
      scrollEl.getBoundingClientRect().top +
      scrollEl.scrollTop;
    scrollEl.scrollTo({ top: Math.max(0, top - SCROLL_TOP_PADDING_PX) });
  };

  // Editable zoom field: a free-typed string committed on Enter/blur.
  const [zoomText, setZoomText] = useState(() => String(Math.round(scale * 100)));
  const [editingZoom, setEditingZoom] = useState(false);
  // Set when Escape blurs the field, so the resulting commit cancels instead.
  const cancelCommitRef = useRef(false);
  useEffect(() => {
    if (!editingZoom) setZoomText(String(Math.round(scale * 100)));
  }, [scale, editingZoom]);

  const applyZoom = (z: number) => setPdfZoom(clampZoom(z));
  const commitZoom = () => {
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      setEditingZoom(false);
      return;
    }
    const pct = Number.parseInt(zoomText, 10);
    if (Number.isFinite(pct)) applyZoom(pct / 100);
    setEditingZoom(false);
  };

  // Editable page field: the same free-typed-string pattern as zoom. Committing
  // jumps the column to that page; while idle it tracks the visible page.
  const [pageText, setPageText] = useState("1");
  const [editingPage, setEditingPage] = useState(false);
  const cancelPageCommitRef = useRef(false);
  useEffect(() => {
    if (!editingPage) setPageText(String(current));
  }, [current, editingPage]);

  const commitPage = () => {
    if (cancelPageCommitRef.current) {
      cancelPageCommitRef.current = false;
      setEditingPage(false);
      return;
    }
    const n = Number.parseInt(pageText, 10);
    if (Number.isFinite(n)) scrollToPage(n);
    setEditingPage(false);
  };

  // Load the document whenever fresh PDF bytes arrive.
  useEffect(() => {
    if (!pdfBase64) {
      setDoc(null);
      setBaseSize(null);
      return;
    }
    let cancelled = false;
    // A document is already showing → these are re-compiled bytes for the same
    // project, so keep the reader on their page. No prior doc (opening a project,
    // first compile) → start at the top. (A project switch tears the doc down to
    // null first, so it correctly reads as a fresh load here.)
    const restoreTo = docRef.current ? currentRef.current : 1;
    const task = pdfjsLib.getDocument({ data: base64ToBytes(pdfBase64) });
    task.promise
      .then(async (d) => {
        if (cancelled) return;
        // Measure page 1 once to size every page box (a manuscript is uniform).
        const first = await d.getPage(1);
        if (cancelled) return;
        const viewport = first.getViewport({ scale: 1 });
        const target = clamp(restoreTo, 1, d.numPages);
        restorePageRef.current = target;
        setBaseSize({ width: viewport.width, height: viewport.height });
        setDoc(d);
        setCurrent(target);
      })
      .catch(() => {
        if (!cancelled) {
          setDoc(null);
          setBaseSize(null);
        }
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
    // Re-run only on new bytes; the page to restore is read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfBase64]);

  // Once the (re)compiled document has mounted and its page boxes are sized,
  // jump to the page captured above so a re-compile doesn't lose the reader's
  // place. A layout effect runs before paint, so there's no flash at the top.
  useLayoutEffect(() => {
    const target = restorePageRef.current;
    if (target == null || !doc || !baseSize || !scrollEl) return;
    restorePageRef.current = null;
    scrollToPage(target);
    // scrollToPage closes over the freshly-mounted doc/scrollEl; deps cover the remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, baseSize, scrollEl]);

  // Track the most-visible page for the page indicator.
  useEffect(() => {
    if (!scrollEl || !doc) return;
    ratios.current.clear();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page);
          ratios.current.set(n, e.intersectionRatio);
        }
        let best = 1;
        let bestRatio = -1;
        for (const [n, r] of ratios.current) {
          if (r > bestRatio) {
            bestRatio = r;
            best = n;
          }
        }
        setCurrent(best);
      },
      { root: scrollEl, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    scrollEl.querySelectorAll("[data-page]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [scrollEl, doc]);

  const numPages = doc?.numPages ?? 0;
  const compiling = status === "compiling";

  return (
    <aside className="flex h-full min-h-0 flex-col bg-muted">
      <div className="flex h-10 items-center justify-between border-b border-border bg-background px-3">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-xs text-muted-foreground">preview.pdf</span>
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            {at ? `compiled ${(durationMs / 1000).toFixed(1)}s` : "loaded"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" title="Re-compile" onClick={() => void compileNow()} disabled={compiling}>
            {compiling ? <Spinner /> : <IconRefresh />}
          </Button>
          {numPages > 0 ? (
            <span className="flex items-center gap-1 text-[11.5px] tabular-nums text-muted-foreground">
              <Input
                value={pageText}
                inputMode="numeric"
                aria-label="Current page"
                className="h-6 w-9 rounded-sm px-1 text-center text-[11.5px] tabular-nums md:text-[11.5px]"
                onFocus={(e) => {
                  setEditingPage(true);
                  e.currentTarget.select();
                }}
                onChange={(e) =>
                  setPageText(e.target.value.replace(/[^\d]/g, ""))
                }
                onBlur={commitPage}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    cancelPageCommitRef.current = true;
                    e.currentTarget.blur();
                  }
                }}
              />
              <span className="text-faint">/ {numPages}</span>
            </span>
          ) : null}
          <span className="flex items-center gap-1 text-[11.5px] tabular-nums text-muted-foreground">
            <Button variant="ghost" size="icon-xs" title="Zoom out" onClick={() => applyZoom(scale - ZOOM_STEP)}>
              <IconMinus />
            </Button>
            <span className="flex items-center">
              <Input
                value={zoomText}
                inputMode="numeric"
                aria-label="Zoom percent"
                className="h-6 w-10 rounded-sm px-1 text-center text-[11.5px] tabular-nums md:text-[11.5px]"
                onFocus={(e) => {
                  setEditingZoom(true);
                  e.currentTarget.select();
                }}
                onChange={(e) => setZoomText(e.target.value.replace(/[^\d]/g, ""))}
                onBlur={commitZoom}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    cancelCommitRef.current = true;
                    e.currentTarget.blur();
                  }
                }}
              />
              <span className="pl-0.5 text-faint">%</span>
            </span>
            <Button variant="ghost" size="icon-xs" title="Zoom in" onClick={() => applyZoom(scale + ZOOM_STEP)}>
              <IconPlus />
            </Button>
          </span>
          <Button variant="ghost" size="icon-sm" title="Hide preview" onClick={closePdf}>
            <IconX />
          </Button>
        </div>
      </div>

      <div ref={setScrollEl} className="min-h-0 flex-1 overflow-auto p-4">
        {doc && baseSize ? (
          <div className="flex flex-col items-center gap-4">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPageView
                key={i + 1}
                doc={doc}
                pageNumber={i + 1}
                scale={scale}
                baseSize={baseSize}
                root={scrollEl}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            {compiling || doc ? (
              <>
                <Spinner className="size-6 text-faint" />
                <p className="text-sm">{compiling ? "Compiling" : "Rendering"}</p>
              </>
            ) : (
              <>
                <p className="max-w-[220px] text-sm text-faint">
                  No preview yet. Compile the project to typeset the PDF.
                </p>
                <Button size="sm" onClick={() => void compileNow()}>
                  <IconPlayerPlayFilled /> Compile
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
