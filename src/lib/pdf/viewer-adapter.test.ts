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
  id?: string;
  numPages: number;
}

interface FakeLoadingTask {
  promise: Promise<FakePdfDocument>;
  destroy: Mock<() => Promise<void>>;
}

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let reject: (reason: unknown) => void = () => {
    throw new Error("Deferred rejector was not initialized");
  };
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred resolver was not initialized");
  };
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });
  return { promise, reject, resolve };
}

function settlementState(
  promise: Promise<void>,
): Promise<"pending" | "rejected" | "resolved"> {
  return Promise.race([
    promise.then(
      () => "resolved" as const,
      () => "rejected" as const,
    ),
    new Promise<"pending">((resolve) => {
      window.setTimeout(() => resolve("pending"), 0);
    }),
  ]);
}

function createFakePdfRuntime({ pages }: { pages: number }) {
  let eventBus: FakeEventBus | null = null;
  let linkService: FakePDFLinkService | null = null;
  let findController: FakePDFFindController | null = null;
  let viewer: FakePDFViewer | null = null;
  let setViewerError: Error | null = null;

  class FakeEventBusConstructor extends FakeEventBus {
    constructor() {
      super();
      eventBus = this;
    }
  }

  class FakePDFLinkService {
    readonly setViewer = vi.fn((): void => {
      if (setViewerError) throw setViewerError;
    });
    readonly setDocument = vi.fn();

    constructor(_options: unknown) {
      linkService = this;
    }
  }

  class FakePDFFindController {
    private document: FakePdfDocument | null = null;

    readonly setDocument = vi.fn(
      (document: FakePdfDocument | null): void => {
        this.document = document;
      },
    );

    constructor({ eventBus }: { eventBus: FakeEventBus }) {
      findController = this;
      eventBus.on("find", (event) => {
        if (!this.document || event.query !== "chapter") return;
        eventBus.emit("updatefindcontrolstate", {
          state: 0,
          matchesCount: { current: 1, total: 1 },
        });
      });
    }
  }

  interface FakeViewerOptions {
    abortSignal: AbortSignal;
    eventBus: FakeEventBus;
    linkService: FakePDFLinkService;
    findController: FakePDFFindController;
  }

  class FakePDFViewer {
    currentPageNumber = 1;
    currentScale = 1;
    initializeOnSetDocument = true;
    pagesPromise: Promise<void> = Promise.resolve();
    readonly pagesCount = pages;
    readonly options: FakeViewerOptions;
    readonly setDocument = vi.fn((document: FakePdfDocument | null): void => {
      if (document && this.initializeOnSetDocument) {
        eventBus?.emit("pagesinit", {});
      }
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
    failLinkViewerSetup(error: Error): void {
      setViewerError = error;
    },
    get eventBus(): FakeEventBus {
      if (!eventBus) throw new Error("EventBus was not constructed");
      return eventBus;
    },
    get linkService(): FakePDFLinkService {
      if (!linkService) throw new Error("PDFLinkService was not constructed");
      return linkService;
    },
    get findController(): FakePDFFindController {
      if (!findController) {
        throw new Error("PDFFindController was not constructed");
      }
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
    expect(onReady).toHaveBeenCalledWith({
      page: 8,
      pageCount: 12,
      scale: 1.25,
    });
    harness.eventBus.emit("pagechanging", { pageNumber: 6 });
    harness.eventBus.emit("scalechanging", { scale: 1.5 });
    expect(onPageChange).toHaveBeenCalledWith(6);
    expect(onScaleChange).toHaveBeenCalledWith(1.5);
  });

  it("centers the PDF in the scroll viewport after initialization", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const options = createAdapterOptions(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    Object.defineProperties(options.container, {
      clientWidth: { value: 400 },
      scrollWidth: { value: 800 },
    });
    const adapter = await createPdfViewerAdapter(options);

    await adapter.loadDocument(new Uint8Array([1]), { page: 1, scale: 1 });

    expect(options.container.scrollLeft).toBe(200);
  });

  // Mutation caught: resolving loadDocument before pagesinit.
  it("keeps document loading pending until the viewer initializes", async () => {
    const harness = createFakePdfRuntime({ pages: 12 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const lifecycle: string[] = [];
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(
        () => lifecycle.push("ready"),
        vi.fn(),
        vi.fn(),
        vi.fn(),
        vi.fn(),
      ),
    );
    harness.viewer.initializeOnSetDocument = false;

    const load = adapter
      .loadDocument(new Uint8Array([1]), { page: 8, scale: 1.25 })
      .then(() => {
        lifecycle.push("resolved");
      });
    await vi.waitFor(() =>
      expect(harness.viewer.setDocument).toHaveBeenCalledTimes(1),
    );

    const stateBeforeInitialization = await Promise.race([
      load.then(() => "resolved"),
      new Promise<string>((resolve) => {
        window.setTimeout(() => resolve("pending"), 0);
      }),
    ]);
    expect(stateBeforeInitialization).toBe("pending");
    expect(lifecycle).toEqual([]);
    harness.eventBus.emit("pagesinit", {});
    await load;
    expect(lifecycle).toEqual(["ready", "resolved"]);
  });

  // Mutation caught: ignoring the active viewer pagesPromise rejection.
  it("reports and rejects viewer initialization failures", async () => {
    const harness = createFakePdfRuntime({ pages: 12 });
    const initialization = createDeferred<void>();
    const error = new Error("First PDF page failed");
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onError = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const adapter = await createPdfViewerAdapter(
        createAdapterOptions(
          vi.fn(),
          vi.fn(),
          vi.fn(),
          vi.fn(),
          onError,
        ),
      );
      harness.viewer.initializeOnSetDocument = false;
      harness.viewer.pagesPromise = initialization.promise;
      void initialization.promise.catch(() => undefined);

      const load = adapter.loadDocument(new Uint8Array([1]), {
        page: 8,
        scale: 1.25,
      });
      await vi.waitFor(() =>
        expect(harness.viewer.setDocument).toHaveBeenCalledTimes(1),
      );
      initialization.reject(error);
      const outcome = await Promise.race([
        load.then(
          () => "resolved",
          () => "rejected",
        ),
        new Promise<string>((resolve) => {
          window.setTimeout(() => resolve("pending"), 0);
        }),
      ]);

      expect(outcome).toBe("rejected");
      await expect(load).rejects.toThrow("First PDF page failed");
      expect(onError).toHaveBeenCalledWith({
        phase: "initialize",
        message: "First PDF page failed",
        error,
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  // Mutation caught: clearing without settling the stale initialization.
  it("settles pending initialization when the document is cleared", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onError = vi.fn();
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(
        vi.fn(),
        vi.fn(),
        vi.fn(),
        vi.fn(),
        onError,
      ),
    );
    harness.viewer.initializeOnSetDocument = false;

    const load = adapter.loadDocument(new Uint8Array([1]), {
      page: 1,
      scale: 1,
    });
    await vi.waitFor(() =>
      expect(harness.viewer.setDocument).toHaveBeenCalledTimes(1),
    );
    await adapter.clearDocument();

    expect(await settlementState(load)).toBe("resolved");
    expect(onError).not.toHaveBeenCalled();
    await adapter.dispose();
  });

  // Mutation caught: replacement overwriting a stale initialization resolver.
  it("settles pending initialization when the document is replaced", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    const firstDocument = { id: "first", numPages: 2 };
    const secondDocument = { id: "second", numPages: 2 };
    const firstTask: FakeLoadingTask = {
      promise: Promise.resolve(firstDocument),
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
    const onError = vi.fn();
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(
        vi.fn(),
        vi.fn(),
        vi.fn(),
        vi.fn(),
        onError,
      ),
    );
    harness.viewer.initializeOnSetDocument = false;

    const firstLoad = adapter.loadDocument(new Uint8Array([1]), {
      page: 1,
      scale: 1,
    });
    await vi.waitFor(() =>
      expect(harness.viewer.setDocument).toHaveBeenCalledTimes(1),
    );
    const secondLoad = adapter.loadDocument(new Uint8Array([2]), {
      page: 1,
      scale: 1,
    });
    await vi.waitFor(() =>
      expect(harness.viewer.setDocument).toHaveBeenCalledWith(secondDocument),
    );
    harness.eventBus.emit("pagesinit", {});
    await secondLoad;

    expect(await settlementState(firstLoad)).toBe("resolved");
    expect(onError).not.toHaveBeenCalled();
    await adapter.dispose();
  });

  // Mutation caught: disposal leaving active initialization unresolved.
  it("settles pending initialization when the adapter is disposed", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onError = vi.fn();
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(
        vi.fn(),
        vi.fn(),
        vi.fn(),
        vi.fn(),
        onError,
      ),
    );
    harness.viewer.initializeOnSetDocument = false;

    const load = adapter.loadDocument(new Uint8Array([1]), {
      page: 1,
      scale: 1,
    });
    await vi.waitFor(() =>
      expect(harness.viewer.setDocument).toHaveBeenCalledTimes(1),
    );
    await adapter.dispose();

    expect(await settlementState(load)).toBe("resolved");
    expect(onError).not.toHaveBeenCalled();
  });

  // Mutation caught: treating a stale pagesinit event as the active load.
  it("ignores initialization events after their load is cleared", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onReady = vi.fn();
    const onError = vi.fn();
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(
        onReady,
        vi.fn(),
        vi.fn(),
        vi.fn(),
        onError,
      ),
    );
    harness.viewer.initializeOnSetDocument = false;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const load = adapter.loadDocument(new Uint8Array([1]), {
        page: 1,
        scale: 1,
      });
      await vi.waitFor(() =>
        expect(harness.viewer.setDocument).toHaveBeenCalledTimes(1),
      );
      await adapter.clearDocument();
      await load;

      expect(() => harness.eventBus.emit("pagesinit", {})).not.toThrow();
      expect(onReady).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      await adapter.dispose();
    } finally {
      consoleError.mockRestore();
    }
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

  it("makes the loaded PDF document searchable", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onFindResult = vi.fn();
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), onFindResult, vi.fn()),
    );
    await adapter.loadDocument(new Uint8Array([1]), { page: 1, scale: 1 });

    adapter.search({
      query: "chapter",
      caseSensitive: false,
      wholeWord: false,
    });

    expect(onFindResult).toHaveBeenLastCalledWith({
      status: "found",
      current: 1,
      total: 1,
      error: null,
    });
  });

  it("maps PDF.js state and progressive count events into strict results", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onFindResult = vi.fn();
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), onFindResult, vi.fn()),
    );
    adapter.search({
      query: "chapter",
      caseSensitive: false,
      wholeWord: false,
    });
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

  it("keeps search error details while progressive counts change", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onFindResult = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const adapter = await createPdfViewerAdapter(
        createAdapterOptions(
          vi.fn(),
          vi.fn(),
          vi.fn(),
          onFindResult,
          vi.fn(),
        ),
      );
      adapter.search({
        query: "chapter",
        caseSensitive: false,
        wholeWord: false,
      });
      harness.eventBus.emit("updatefindcontrolstate", {
        state: 99,
        matchesCount: { current: 0, total: 0 },
      });
      harness.eventBus.emit("updatefindmatchescount", {
        matchesCount: { current: 1, total: 4 },
      });
      expect(onFindResult).toHaveBeenLastCalledWith({
        status: "error",
        current: 1,
        total: 4,
        error: "Unknown PDF.js find state: 99",
      });
    } finally {
      consoleError.mockRestore();
    }
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

  it("ignores find events after an empty query closes search", async () => {
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
    harness.eventBus.emit("updatefindcontrolstate", {
      state: harness.module.FindState.FOUND,
      matchesCount: { current: 1, total: 2 },
    });
    harness.eventBus.emit("updatefindmatchescount", {
      matchesCount: { current: 2, total: 2 },
    });
    expect(onFindResult).toHaveBeenCalledTimes(1);
    expect(onFindResult).toHaveBeenLastCalledWith({
      status: "idle",
      current: 0,
      total: 0,
      error: null,
    });
  });

  it("ignores a stale document completion after replacement", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    const firstDocument = { id: "first", numPages: 2 };
    const secondDocument = { id: "second", numPages: 2 };
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
    const staleLoad = adapter.loadDocument(new Uint8Array([1]), {
      page: 1,
      scale: 1,
    });
    await adapter.loadDocument(new Uint8Array([2]), { page: 1, scale: 1 });
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

  // Mutation caught: disposing without aborting the viewer-owned signal.
  it("aborts the exact signal passed to the viewer on dispose", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()),
    );
    const viewerSignal = harness.viewer.options.abortSignal;

    expect(viewerSignal).toBeInstanceOf(AbortSignal);
    expect(viewerSignal.aborted).toBe(false);
    await adapter.dispose();
    expect(viewerSignal.aborted).toBe(true);
  });

  // Mutation caught: construction failure leaking a partially created viewer.
  it("aborts the viewer signal when adapter construction fails", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    const error = new Error("Link service setup failed");
    const onError = vi.fn();
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    harness.failLinkViewerSetup(error);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(
        createPdfViewerAdapter(
          createAdapterOptions(
            vi.fn(),
            vi.fn(),
            vi.fn(),
            vi.fn(),
            onError,
          ),
        ),
      ).rejects.toThrow("Link service setup failed");
      expect(harness.viewer.options.abortSignal.aborted).toBe(true);
      expect(onError).toHaveBeenCalledWith({
        phase: "initialize",
        message: "Link service setup failed",
        error,
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  // Mutation caught: an earlier cleanup failure preventing signal abortion.
  it("reports and rethrows listener cleanup failures", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    const error = new Error("Listener cleanup failed");
    const taskError = new Error("Loading task cleanup failed");
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onError = vi.fn();
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), vi.fn(), onError),
    );
    const viewerSignal = harness.viewer.options.abortSignal;
    await adapter.loadDocument(new Uint8Array([1]), { page: 1, scale: 1 });
    harness.eventBus.off.mockImplementationOnce(() => {
      throw error;
    });
    harness.loadingTask.destroy.mockRejectedValueOnce(taskError);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(adapter.dispose()).rejects.toThrow(
        "Listener cleanup failed",
      );
      expect(onError).toHaveBeenCalledWith({
        phase: "cleanup",
        message: "Listener cleanup failed",
        error,
      });
      expect(harness.eventBus.off).toHaveBeenCalledTimes(5);
      expect(harness.viewer.setDocument).toHaveBeenLastCalledWith(null);
      expect(harness.linkService.setDocument).toHaveBeenLastCalledWith(
        null,
        null,
      );
      expect(harness.loadingTask.destroy).toHaveBeenCalledTimes(1);
      expect(viewerSignal.aborted).toBe(true);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("continues document cleanup after viewer detachment fails", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    const error = new Error("Viewer detachment failed");
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onError = vi.fn();
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), vi.fn(), onError),
    );
    await adapter.loadDocument(new Uint8Array([1]), { page: 1, scale: 1 });
    harness.viewer.setDocument.mockImplementationOnce(() => {
      throw error;
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(adapter.dispose()).rejects.toThrow(
        "Viewer detachment failed",
      );
      expect(harness.eventBus.off).toHaveBeenCalledTimes(5);
      expect(harness.linkService.setDocument).toHaveBeenLastCalledWith(
        null,
        null,
      );
      expect(harness.loadingTask.destroy).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith({
        phase: "cleanup",
        message: "Viewer detachment failed",
        error,
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("destroys the loading task after link detachment fails", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    const error = new Error("Link detachment failed");
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    runtime.getDocument.mockReturnValue(harness.loadingTask);
    const onError = vi.fn();
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), vi.fn(), onError),
    );
    await adapter.loadDocument(new Uint8Array([1]), { page: 1, scale: 1 });
    harness.linkService.setDocument.mockImplementationOnce(() => {
      throw error;
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(adapter.dispose()).rejects.toThrow(
        "Link detachment failed",
      );
      expect(harness.viewer.setDocument).toHaveBeenLastCalledWith(null);
      expect(harness.loadingTask.destroy).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith({
        phase: "cleanup",
        message: "Link detachment failed",
        error,
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("rejects document loads after disposal", async () => {
    const harness = createFakePdfRuntime({ pages: 2 });
    runtime.loadViewerModule.mockResolvedValue(harness.module);
    const adapter = await createPdfViewerAdapter(
      createAdapterOptions(vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()),
    );
    await adapter.dispose();
    await expect(
      adapter.loadDocument(new Uint8Array([1]), { page: 1, scale: 1 }),
    ).rejects.toThrow("PDF viewer adapter has been disposed");
    expect(runtime.getDocument).not.toHaveBeenCalled();
  });
});
