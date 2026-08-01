import type { PDFDocumentProxy } from "pdfjs-dist";

declare module "pdfjs-dist/web/pdf_viewer.mjs" {
  interface PDFFindController {
    setDocument(pdfDocument: PDFDocumentProxy | null): void;
  }

  interface PDFViewer {
    setDocument(pdfDocument: PDFDocumentProxy | null): void;
  }
}
