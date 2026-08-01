import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type PdfViewerModule = typeof import("pdfjs-dist/web/pdf_viewer.mjs");

if (!(Symbol.asyncIterator in ReadableStream.prototype)) {
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: async function* readableStreamAsyncIterator<T>(
      this: ReadableStream<T>,
    ): AsyncGenerator<T, void, unknown> {
      const reader = this.getReader();
      let complete = false;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) {
            complete = true;
            return;
          }
          yield result.value;
        }
      } finally {
        try {
          if (!complete) await reader.cancel();
        } finally {
          reader.releaseLock();
        }
      }
    },
  });
}

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

let viewerModulePromise: Promise<PdfViewerModule> | null = null;

export function loadPdfViewerModule(): Promise<PdfViewerModule> {
  Object.assign(globalThis, { pdfjsLib });
  viewerModulePromise ??= import("pdfjs-dist/web/pdf_viewer.mjs");
  return viewerModulePromise;
}

export { pdfjsLib };
