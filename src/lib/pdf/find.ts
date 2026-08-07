export interface PdfFindQuery {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export type PdfFindStatus =
  | "idle"
  | "pending"
  | "found"
  | "not-found"
  | "wrapped"
  | "error";

export interface PdfFindResult {
  status: PdfFindStatus;
  current: number;
  total: number;
  error: string | null;
}

export const EMPTY_PDF_FIND_RESULT: PdfFindResult = {
  status: "idle",
  current: 0,
  total: 0,
  error: null,
};
