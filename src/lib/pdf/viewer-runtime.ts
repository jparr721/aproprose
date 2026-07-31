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
