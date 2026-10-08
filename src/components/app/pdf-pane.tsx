import { notifyAppError, reportNotification } from "@/lib/notifications";
import { useEffect, useRef, useState } from "react";
import { clamp } from "es-toolkit";
import {
  Check as IconCheck,
  Copy as IconCopy,
  Minus as IconMinus,
  Play as IconPlayerPlayFilled,
  Plus as IconPlus,
  RefreshCw as IconRefresh,
  X as IconX,
} from "lucide-react";
import { PdfFindBar } from "@/components/app/pdf-find-bar";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TypographyMuted, TypographyForeground, TypographyMutedSpan } from "@/components/ui/typography";
import { copyText } from "@/lib/clipboard";
import {
  base64ToBytes,
  createPdfViewerAdapter,
  type PdfViewerAdapter,
  type PdfViewerFailure,
} from "@/lib/pdf/viewer-adapter";
import { pdfPath as resolvePdfPath } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { usePdfFindStore } from "@/stores/pdf-find-store";
import { useProjectStore } from "@/stores/project-store";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.1;

function clampZoom(zoom: number): number {
  return clamp(Math.round(zoom * 100) / 100, ZOOM_MIN, ZOOM_MAX);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function persistPdfZoom(scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0) return;
  const settings = useSettingsStore.getState();
  if (settings.pdfZoom !== scale) settings.setPdfZoom(scale);
}

function logCleanupFailure(error: unknown): void {
  console.error("[pdf-viewer]", { phase: "cleanup", error });
}

function runPdfSearchOperation(operation: () => void): void {
  try {
    operation();
  } catch (error) {
    reportNotification({ type: "pdf-search", source: "PDF preview", projectRoot: useProjectStore.getState().project?.root ?? null, provider: null });
    usePdfFindStore.getState().setError(errorMessage(error));
  }
}

export function PdfPane() {
  const project = useProjectStore((state) => state.project);
  const pdfBase64 = useProjectStore((state) => state.compile.pdfBase64);
  const status = useProjectStore((state) => state.compile.status);
  const at = useProjectStore((state) => state.compile.at);
  const durationMs = useProjectStore((state) => state.compile.durationMs);
  const compileNow = useProjectStore((state) => state.compileNow);
  const closePdf = useViewStore((state) => state.togglePdf);
  const scale = useSettingsStore((state) => state.pdfZoom);
  const setPdfZoom = useSettingsStore((state) => state.setPdfZoom);
  const activeSurface = useSearchSurfaceStore((state) => state.activeSurface);
  const openSurface = useSearchSurfaceStore((state) => state.openSurface);
  const activateSearchSurface = useSearchSurfaceStore(
    (state) => state.activate,
  );
  const query = usePdfFindStore((state) => state.query);
  const caseSensitive = usePdfFindStore((state) => state.caseSensitive);
  const wholeWord = usePdfFindStore((state) => state.wholeWord);
  const pdfActive = activeSurface === "pdf";

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

  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;
    if (!container || !viewer) return;

    let cancelled = false;
    let createdAdapter: PdfViewerAdapter | null = null;

    void createPdfViewerAdapter({
      container,
      viewer,
      onReady: (view) => {
        if (cancelled) return;
        setCurrent(view.page);
        setNumPages(view.pageCount);
        persistPdfZoom(view.scale);
        setViewerError(null);
      },
      onPageChange: (page) => {
        if (!cancelled) setCurrent(page);
      },
      onScaleChange: (nextScale) => {
        if (!cancelled) persistPdfZoom(nextScale);
      },
      onFindResult: (result) => {
        if (!cancelled) usePdfFindStore.getState().setResult(result);
      },
      onError: (failure: PdfViewerFailure) => {
        if (cancelled) return;
        reportNotification({ type: failure.phase === "search" ? "pdf-search" : "pdf-preview", source: "PDF preview", projectRoot: useProjectStore.getState().project?.root ?? null, provider: null });
        if (failure.phase === "search") {
          usePdfFindStore.getState().setError(failure.message);
          return;
        }
        setViewerError(failure.message);
      },
    })
      .then((adapter) => {
        createdAdapter = adapter;
        if (cancelled) {
          void adapter.dispose().catch(logCleanupFailure);
          return;
        }
        adapterRef.current = adapter;
        setAdapterRevision((revision) => revision + 1);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          reportNotification({ type: "pdf-preview", source: "PDF preview", projectRoot: project === null ? null : project.root, provider: null });
          setViewerError(errorMessage(error));
        }
      });

    return () => {
      cancelled = true;
      if (!createdAdapter) return;
      if (adapterRef.current === createdAdapter) adapterRef.current = null;
      void createdAdapter.dispose().catch(logCleanupFailure);
    };
  }, []);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;

    let cancelled = false;
    setViewerError(null);

    if (!pdfBase64) {
      hasDocumentRef.current = false;
      setNumPages(0);
      setCurrent(1);
      usePdfFindStore.getState().resetMatches();
      void adapter.clearDocument().catch((error: unknown) => {
        if (!cancelled) {
          reportNotification({ type: "pdf-preview", source: "PDF preview", projectRoot: project === null ? null : project.root, provider: null });
          setViewerError(errorMessage(error));
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const targetPage = hasDocumentRef.current ? currentRef.current : 1;
    hasDocumentRef.current = false;
    usePdfFindStore.getState().resetMatches();

    void (async () => {
      try {
        await adapter.loadDocument(base64ToBytes(pdfBase64), {
          page: targetPage,
          scale: useSettingsStore.getState().pdfZoom,
        });
        if (cancelled) return;
        hasDocumentRef.current = true;
        setDocumentRevision((revision) => revision + 1);
      } catch (error) {
        if (cancelled) return;
        setNumPages(0);
        setCurrent(1);
        usePdfFindStore.getState().resetMatches();
        reportNotification({ type: "pdf-preview", source: "PDF preview", projectRoot: project === null ? null : project.root, provider: null });
        setViewerError(errorMessage(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adapterRevision, pdfBase64]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    if (openSurface !== "pdf") {
      runPdfSearchOperation(() => adapter.closeSearch());
      return;
    }
    runPdfSearchOperation(() =>
      adapter.search({ query, caseSensitive, wholeWord }),
    );
  }, [
    adapterRevision,
    documentRevision,
    openSurface,
    query,
    caseSensitive,
    wholeWord,
  ]);

  const [zoomText, setZoomText] = useState(() =>
    String(Math.round(scale * 100)),
  );
  const [editingZoom, setEditingZoom] = useState(false);
  const cancelCommitRef = useRef(false);
  useEffect(() => {
    if (!editingZoom) setZoomText(String(Math.round(scale * 100)));
  }, [scale, editingZoom]);

  const applyZoom = (zoom: number): void => {
    const clampedScale = clampZoom(zoom);
    setPdfZoom(clampedScale);
    adapterRef.current?.setScale(clampedScale);
  };

  const commitZoom = (): void => {
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      setEditingZoom(false);
      return;
    }
    const percent = Number.parseInt(zoomText, 10);
    if (Number.isFinite(percent)) applyZoom(percent / 100);
    setEditingZoom(false);
  };

  const [pageText, setPageText] = useState("1");
  const [editingPage, setEditingPage] = useState(false);
  const cancelPageCommitRef = useRef(false);
  useEffect(() => {
    if (!editingPage) setPageText(String(current));
  }, [current, editingPage]);

  const commitPage = (): void => {
    if (cancelPageCommitRef.current) {
      cancelPageCommitRef.current = false;
      setEditingPage(false);
      return;
    }
    const parsedPage = Number.parseInt(pageText, 10);
    if (Number.isFinite(parsedPage)) {
      adapterRef.current?.setPage(parsedPage);
    }
    setEditingPage(false);
  };

  const compiling = status === "compiling";
  const hasDocument =
    pdfBase64 !== null &&
    hasDocumentRef.current &&
    documentRevision > 0;

  const root = project?.root;
  const mainFile = project?.mainFile;
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  useEffect(() => {
    if (!root || !mainFile) {
      setPdfPath(null);
      return;
    }
    let cancelled = false;
    resolvePdfPath(root, mainFile)
      .then((path) => {
        if (!cancelled) setPdfPath(path);
      })
      .catch(() => {
        if (!cancelled) setPdfPath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [root, mainFile]);

  const [copied, setCopied] = useState(false);
  const copyLabel = copied ? "Copied PDF path" : "Copy PDF path";
  const copyPath = async (): Promise<void> => {
    if (!pdfPath) return;
    if (!(await copyText(pdfPath))) {
      notifyAppError("clipboard", "Clipboard", useProjectStore.getState().project?.root ?? null, new Error("clipboard operation failed"));
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <aside
      aria-label={
        pdfActive ? "PDF preview, active search surface" : "PDF preview"
      }
      data-search-surface="pdf"
      onPointerDownCapture={() => activateSearchSurface("pdf")}
      onFocusCapture={() => activateSearchSurface("pdf")}
      className="flex h-full min-h-0 flex-col bg-muted"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-3 py-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="flex items-center gap-0.5">
            <TypographyForeground
              className={cn(
                "text-xs",
                pdfActive
                  ? "font-medium text-accent-ink"
                  : "text-muted-foreground",
              )}
            >
              preview.pdf
            </TypographyForeground>
            {pdfPath ? (
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
            ) : null}
          </span>
          <TypographyMutedSpan className="text-xs">
            {at ? `compiled ${(durationMs / 1000).toFixed(1)}s` : "loaded"}
          </TypographyMutedSpan>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Re-compile"
            onClick={() => void compileNow()}
            disabled={compiling}
          >
            {compiling ? <Spinner /> : <IconRefresh />}
          </Button>
          {numPages > 0 ? (
            <InputGroup className="h-7 w-24">
              <InputGroupInput
                value={pageText}
                inputMode="numeric"
                aria-label="Current page"
                className="px-1 text-center text-xs tabular-nums md:text-xs"
                onFocus={(event) => {
                  setEditingPage(true);
                  event.currentTarget.select();
                }}
                onChange={(event) =>
                  setPageText(event.target.value.replace(/[^\d]/g, ""))
                }
                onBlur={commitPage}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    cancelPageCommitRef.current = true;
                    event.currentTarget.blur();
                  }
                }}
              />
              <InputGroupAddon align="inline-end">/ {numPages}</InputGroupAddon>
            </InputGroup>
          ) : null}
          <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
            <Button
              variant="ghost"
              size="icon-xs"
              title="Zoom out"
              onClick={() => applyZoom(scale - ZOOM_STEP)}
            >
              <IconMinus />
            </Button>
            <InputGroup className="h-7 w-20">
              <InputGroupInput
                value={zoomText}
                inputMode="numeric"
                aria-label="Zoom percent"
                className="px-1 text-center text-xs tabular-nums md:text-xs"
                onFocus={(event) => {
                  setEditingZoom(true);
                  event.currentTarget.select();
                }}
                onChange={(event) =>
                  setZoomText(event.target.value.replace(/[^\d]/g, ""))
                }
                onBlur={commitZoom}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    cancelCommitRef.current = true;
                    event.currentTarget.blur();
                  }
                }}
              />
              <InputGroupAddon align="inline-end">%</InputGroupAddon>
            </InputGroup>
            <Button
              variant="ghost"
              size="icon-xs"
              title="Zoom in"
              onClick={() => applyZoom(scale + ZOOM_STEP)}
            >
              <IconPlus />
            </Button>
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Hide preview"
            onClick={closePdf}
          >
            <IconX />
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <PdfFindBar
          onNext={() =>
            runPdfSearchOperation(() => adapterRef.current?.nextMatch())
          }
          onPrevious={() =>
            runPdfSearchOperation(() => adapterRef.current?.previousMatch())
          }
        />
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-auto bg-muted"
          aria-label="PDF pages"
        >
          <div
            ref={viewerRef}
            className="pdfViewer aproprose-pdf-viewer"
          />
        </div>
        {!hasDocument ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted p-4 text-center">
            {viewerError ? (
              <Alert variant="destructive" className="max-w-sm">
                <AlertTitle>PDF preview unavailable</AlertTitle>
                <AlertDescription>{viewerError}</AlertDescription>
              </Alert>
            ) : compiling || pdfBase64 ? (
              <>
                <Spinner className="size-6 text-faint" />
                <TypographyMuted>
                  {compiling ? "Compiling" : "Rendering"}
                </TypographyMuted>
              </>
            ) : (
              <>
                <TypographyMuted className="max-w-[220px] text-faint">
                  No preview yet. Compile the project to typeset the PDF.
                </TypographyMuted>
                <Button size="sm" onClick={() => void compileNow()}>
                  <IconPlayerPlayFilled /> Compile
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
