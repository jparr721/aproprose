import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));

import { toast } from "sonner";
import { withAiRetry } from "@/lib/ai/errors";

beforeEach(() => {
  vi.mocked(toast.warning).mockClear();
});

describe("withAiRetry", () => {
  it("resolves on the first attempt without warning", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withAiRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("warns and retries once after a failure, then resolves", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    await expect(withAiRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(toast.warning).toHaveBeenCalledWith("AI request failed - retrying");
  });

  it("rethrows the second error after a failed retry", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"));
    await expect(withAiRetry(fn)).rejects.toThrow("second");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rethrows an abort immediately without retrying or warning", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const fn = vi.fn().mockRejectedValue(abort);
    await expect(withAiRetry(fn)).rejects.toBe(abort);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
