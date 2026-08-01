// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const asyncIteratorDescriptor = Object.getOwnPropertyDescriptor(
  ReadableStream.prototype,
  Symbol.asyncIterator,
);
const valuesDescriptor = Object.getOwnPropertyDescriptor(
  ReadableStream.prototype,
  "values",
);

afterEach(() => {
  if (asyncIteratorDescriptor) {
    Object.defineProperty(
      ReadableStream.prototype,
      Symbol.asyncIterator,
      asyncIteratorDescriptor,
    );
  }
  if (valuesDescriptor) {
    Object.defineProperty(
      ReadableStream.prototype,
      "values",
      valuesDescriptor,
    );
  }
  vi.resetModules();
});

describe("PDF viewer runtime", () => {
  it("makes WebKit ReadableStreams async iterable for PDF text extraction", async () => {
    Reflect.deleteProperty(ReadableStream.prototype, Symbol.asyncIterator);
    Reflect.deleteProperty(ReadableStream.prototype, "values");
    vi.resetModules();

    await import("@/lib/pdf/viewer-runtime");

    const stream = new ReadableStream<string>({
      start(controller): void {
        controller.enqueue("page text");
        controller.close();
      },
    });
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toEqual(["page text"]);
    expect(stream.locked).toBe(false);
  });
});
