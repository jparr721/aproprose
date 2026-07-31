import type { PDFDocumentProxy } from "pdfjs-dist";

declare module "pdfjs-dist/web/pdf_viewer.mjs" {
  interface PDFViewer {
    setDocument(pdfDocument: PDFDocumentProxy | null): void;
  }
}
