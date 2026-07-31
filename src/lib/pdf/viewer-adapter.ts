import { clamp } from "es-toolkit";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import {
  EMPTY_PDF_FIND_RESULT,
  type PdfFindQuery,
  type PdfFindResult,
  type PdfFindStatus,
} from "@/lib/pdf/find";
import {
  loadPdfViewerModule,
  pdfjsLib,
  type PdfViewerModule,
} from "@/lib/pdf/viewer-runtime";

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

interface PageChangingEvent {
  pageNumber: number;
}

interface ScaleChangingEvent {
  scale: number;
}

interface PdfFindMatchesCount {
  current: number;
  total: number;
}

interface FindControlStateEvent {
  state: number;
  matchesCount: PdfFindMatchesCount;
}

interface FindMatchesCountEvent {
  matchesCount: PdfFindMatchesCount;
}

interface FindEventState extends PdfFindQuery {
  type: "" | "again";
  findPrevious: boolean;
}

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

function findStatus(
  module: PdfViewerModule,
  state: number,
): Exclude<PdfFindStatus, "idle" | "error"> {
  if (state === module.FindState.FOUND) return "found";
  if (state === module.FindState.NOT_FOUND) return "not-found";
  if (state === module.FindState.WRAPPED) return "wrapped";
  if (state === module.FindState.PENDING) return "pending";
  throw new Error(`Unknown PDF.js find state: ${state}`);
}

export function base64ToBytes(value: string): Uint8Array {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

export async function createPdfViewerAdapter(
  options: PdfViewerAdapterOptions,
): Promise<PdfViewerAdapter> {
  try {
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

    const adapterSource: object = {};
    let activeLoadingTask: PDFDocumentLoadingTask | null = null;
    let disposed = false;
    let loadRevision = 0;
    let pendingView: Pick<PdfViewState, "page" | "scale"> | null = null;
    let latestQuery: PdfFindQuery = {
      query: "",
      caseSensitive: false,
      wholeWord: false,
    };
    let latestFindResult: PdfFindResult = { ...EMPTY_PDF_FIND_RESULT };

    const publishFindResult = (
      status: PdfFindStatus,
      matchesCount: PdfFindMatchesCount,
      error: string | null,
    ): void => {
      latestFindResult = {
        status,
        current: matchesCount.current,
        total: matchesCount.total,
        error,
      };
      options.onFindResult(latestFindResult);
    };

    const handlePagesInit = (): void => {
      if (!pendingView) {
        const error = new Error("PDF pages initialized without a pending view");
        reportFailure(options, "initialize", error);
        throw error;
      }
      pdfViewer.currentPageNumber = clamp(
        pendingView.page,
        1,
        pdfViewer.pagesCount,
      );
      pdfViewer.currentScale = pendingView.scale;
      pendingView = null;
      options.onReady({
        page: pdfViewer.currentPageNumber,
        pageCount: pdfViewer.pagesCount,
        scale: pdfViewer.currentScale,
      });
    };

    const handlePageChanging = (event: PageChangingEvent): void => {
      options.onPageChange(event.pageNumber);
    };

    const handleScaleChanging = (event: ScaleChangingEvent): void => {
      options.onScaleChange(event.scale);
    };

    const handleFindControlState = (event: FindControlStateEvent): void => {
      try {
        publishFindResult(
          findStatus(module, event.state),
          event.matchesCount,
          null,
        );
      } catch (error) {
        const message = errorMessage(error);
        publishFindResult("error", event.matchesCount, message);
        reportFailure(options, "search", error);
      }
    };

    const handleFindMatchesCount = (event: FindMatchesCountEvent): void => {
      publishFindResult(
        latestFindResult.status,
        event.matchesCount,
        latestFindResult.error,
      );
    };

    eventBus.on("pagesinit", handlePagesInit);
    eventBus.on("pagechanging", handlePageChanging);
    eventBus.on("scalechanging", handleScaleChanging);
    eventBus.on("updatefindcontrolstate", handleFindControlState);
    eventBus.on("updatefindmatchescount", handleFindMatchesCount);

    const detachDocument = (): Promise<void> | null => {
      pdfViewer.setDocument(null);
      linkService.setDocument(null, null);
      pendingView = null;
      const loadingTask = activeLoadingTask;
      activeLoadingTask = null;
      return loadingTask ? loadingTask.destroy() : null;
    };

    const clearDocument = async (): Promise<void> => {
      loadRevision += 1;
      try {
        const cleanup = detachDocument();
        if (cleanup) await cleanup;
      } catch (error) {
        reportFailure(options, "cleanup", error);
        throw error;
      }
    };

    const loadDocument = async (
      data: Uint8Array,
      view: Pick<PdfViewState, "page" | "scale">,
    ): Promise<void> => {
      const revision = loadRevision + 1;
      loadRevision = revision;

      try {
        const cleanup = detachDocument();
        if (cleanup) {
          await cleanup;
          if (disposed || revision !== loadRevision) return;
        }

        const loadingTask = pdfjsLib.getDocument({ data });
        activeLoadingTask = loadingTask;
        const document = await loadingTask.promise;
        if (disposed || revision !== loadRevision) return;

        pendingView = view;
        linkService.setDocument(document, null);
        pdfViewer.setDocument(document);
      } catch (error) {
        if (disposed || revision !== loadRevision) return;
        reportFailure(options, "load", error);
        throw error;
      }
    };

    const dispatchFind = (state: FindEventState): void => {
      try {
        eventBus.dispatch("find", {
          source: adapterSource,
          type: state.type,
          query: state.query,
          caseSensitive: state.caseSensitive,
          entireWord: state.wholeWord,
          highlightAll: true,
          findPrevious: state.findPrevious,
          matchDiacritics: false,
        });
      } catch (error) {
        reportFailure(options, "search", error);
        throw error;
      }
    };

    const closeSearch = (): void => {
      try {
        eventBus.dispatch("findbarclose", { source: adapterSource });
      } catch (error) {
        reportFailure(options, "search", error);
        throw error;
      }
    };

    const adapter: PdfViewerAdapter = {
      loadDocument,
      clearDocument,
      setPage: (page: number): void => {
        pdfViewer.currentPageNumber = clamp(page, 1, pdfViewer.pagesCount);
      },
      setScale: (scale: number): void => {
        pdfViewer.currentScale = scale;
      },
      search: (query: PdfFindQuery): void => {
        latestQuery = { ...query };
        if (query.query.length === 0) {
          closeSearch();
          latestFindResult = { ...EMPTY_PDF_FIND_RESULT };
          options.onFindResult(latestFindResult);
          return;
        }
        dispatchFind({
          ...query,
          type: "",
          findPrevious: false,
        });
      },
      nextMatch: (): void => {
        if (latestQuery.query.length === 0) return;
        dispatchFind({
          ...latestQuery,
          type: "again",
          findPrevious: false,
        });
      },
      previousMatch: (): void => {
        if (latestQuery.query.length === 0) return;
        dispatchFind({
          ...latestQuery,
          type: "again",
          findPrevious: true,
        });
      },
      closeSearch,
      getView: (): PdfViewState => ({
        page: pdfViewer.currentPageNumber,
        pageCount: pdfViewer.pagesCount,
        scale: pdfViewer.currentScale,
      }),
      dispose: async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        loadRevision += 1;
        try {
          eventBus.off("pagesinit", handlePagesInit);
          eventBus.off("pagechanging", handlePageChanging);
          eventBus.off("scalechanging", handleScaleChanging);
          eventBus.off("updatefindcontrolstate", handleFindControlState);
          eventBus.off("updatefindmatchescount", handleFindMatchesCount);
          const cleanup = detachDocument();
          if (cleanup) await cleanup;
        } catch (error) {
          reportFailure(options, "cleanup", error);
          throw error;
        }
      },
    };

    return adapter;
  } catch (error) {
    reportFailure(options, "initialize", error);
    throw error;
  }
}
