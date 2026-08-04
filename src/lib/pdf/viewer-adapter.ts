import { clamp } from "es-toolkit";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
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

interface PendingInitialization {
  revision: number;
  reject: (reason: unknown) => void;
  resolve: () => void;
}

type PdfViewerOptionsWithAbortSignal = ConstructorParameters<
  PdfViewerModule["PDFViewer"]
>[0] & {
  abortSignal: AbortSignal;
};

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

function runCleanupOperations(
  operations: ReadonlyArray<() => void>,
): unknown[] {
  const errors: unknown[] = [];
  for (const operation of operations) {
    try {
      operation();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function centerViewer(container: HTMLDivElement): void {
  container.scrollLeft = Math.max(
    0,
    (container.scrollWidth - container.clientWidth) / 2,
  );
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
  const viewerAbortController = new AbortController();
  try {
    const module = await loadPdfViewerModule();
    const eventBus = new module.EventBus();
    const linkService = new module.PDFLinkService({ eventBus });
    const findController = new module.PDFFindController({
      eventBus,
      linkService,
    });
    const setFindDocument = findController.setDocument.bind(findController);
    let findDocument: PDFDocumentProxy | null = null;
    findController.setDocument = (document: PDFDocumentProxy | null): void => {
      if (document === findDocument) return;
      findDocument = document;
      setFindDocument(document);
    };
    const viewerOptions: PdfViewerOptionsWithAbortSignal = {
      container: options.container,
      viewer: options.viewer,
      eventBus,
      linkService,
      findController,
      abortSignal: viewerAbortController.signal,
    };
    const pdfViewer = new module.PDFViewer(viewerOptions);
    linkService.setViewer(pdfViewer);

    const adapterSource: object = {};
    let activeLoadingTask: PDFDocumentLoadingTask | null = null;
    let disposed = false;
    let loadRevision = 0;
    let pendingView: Pick<PdfViewState, "page" | "scale"> | null = null;
    let pendingInitialization: PendingInitialization | null = null;
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
      const initialization = pendingInitialization;
      if (
        !initialization ||
        initialization.revision !== loadRevision ||
        disposed
      ) {
        return;
      }
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
      centerViewer(options.container);
      pendingView = null;
      options.onReady({
        page: pdfViewer.currentPageNumber,
        pageCount: pdfViewer.pagesCount,
        scale: pdfViewer.currentScale,
      });
      pendingInitialization = null;
      initialization.resolve();
    };

    const handlePageChanging = (event: PageChangingEvent): void => {
      options.onPageChange(event.pageNumber);
    };

    const handleScaleChanging = (event: ScaleChangingEvent): void => {
      options.onScaleChange(event.scale);
    };

    const handleFindControlState = (event: FindControlStateEvent): void => {
      if (latestQuery.query.length === 0) return;
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
      if (latestQuery.query.length === 0) return;
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

    const settlePendingInitialization = (): void => {
      const initialization = pendingInitialization;
      pendingInitialization = null;
      pendingView = null;
      initialization?.resolve();
    };

    const detachDocument = (): Promise<void> | null => {
      const loadingTask = activeLoadingTask;
      activeLoadingTask = null;
      settlePendingInitialization();
      const cleanupErrors = runCleanupOperations([
        () => pdfViewer.setDocument(null),
        () => linkService.setDocument(null, null),
      ]);
      if (!loadingTask) {
        return cleanupErrors.length > 0
          ? Promise.reject(cleanupErrors[0])
          : null;
      }
      try {
        return loadingTask.destroy().then(
          () => {
            if (cleanupErrors.length > 0) throw cleanupErrors[0];
          },
          (error: unknown) => {
            cleanupErrors.push(error);
            throw cleanupErrors[0];
          },
        );
      } catch (error) {
        cleanupErrors.push(error);
        return Promise.reject(cleanupErrors[0]);
      }
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
      if (disposed) throw new Error("PDF viewer adapter has been disposed");
      const revision = loadRevision + 1;
      loadRevision = revision;
      let failurePhase: PdfViewerPhase = "load";

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
        failurePhase = "initialize";
        const initialization = new Promise<void>((resolve, reject) => {
          pendingInitialization = { revision, reject, resolve };
        });
        findController.setDocument(document);
        linkService.setDocument(document, null);
        pdfViewer.setDocument(document);
        const pagesPromise: Promise<unknown> | null =
          pdfViewer.pagesPromise;
        if (!pagesPromise) {
          throw new Error("PDF viewer initialization promise is unavailable");
        }
        void pagesPromise.catch((error: unknown) => {
          const pending = pendingInitialization;
          if (
            !pending ||
            pending.revision !== revision ||
            disposed ||
            revision !== loadRevision
          ) {
            return;
          }
          pendingInitialization = null;
          pendingView = null;
          pending.reject(error);
        });
        await initialization;
      } catch (error) {
        if (disposed || revision !== loadRevision) return;
        reportFailure(options, failurePhase, error);
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
        centerViewer(options.container);
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
        const cleanupErrors = runCleanupOperations([
          () => eventBus.off("pagesinit", handlePagesInit),
          () => eventBus.off("pagechanging", handlePageChanging),
          () => eventBus.off("scalechanging", handleScaleChanging),
          () =>
            eventBus.off("updatefindcontrolstate", handleFindControlState),
          () =>
            eventBus.off("updatefindmatchescount", handleFindMatchesCount),
          () => viewerAbortController.abort(),
        ]);
        try {
          const cleanup = detachDocument();
          if (cleanup) await cleanup;
        } catch (error) {
          cleanupErrors.push(error);
        }
        if (cleanupErrors.length > 0) {
          const error = cleanupErrors[0];
          reportFailure(options, "cleanup", error);
          throw error;
        }
      },
    };

    return adapter;
  } catch (error) {
    viewerAbortController.abort();
    reportFailure(options, "initialize", error);
    throw error;
  }
}
