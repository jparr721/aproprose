import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { withAiRetry } from "@/lib/ai/errors";
import { useSettingsDialogStore } from "@/stores/settings-dialog-store";

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsDialogStore.setState({ open: false, aiTarget: null });
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
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce("ok");
    await expect(withAiRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(toast.warning).toHaveBeenCalledWith(
      "The AI request could not be completed. Check your connection and retry.",
      expect.objectContaining({ description: "Retrying once." }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("rethrows the second error after a failed retry", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new Error("second"));
    await expect(withAiRetry(fn)).rejects.toThrow("second");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("rethrows an abort immediately without retrying or warning", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const fn = vi.fn().mockRejectedValue(abort);
    await expect(withAiRetry(fn)).rejects.toBe(abort);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    ["key-missing", "key"],
    ["key-rejected", "key"],
    ["model-unselected", "model"],
    ["model-unavailable", "model"],
  ] as const)(
    "does not retry %s and links to the correct Settings field",
    async (reason, target) => {
      const error = Object.assign(new Error("private diagnostic"), {
        failure: { reason },
      });
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withAiRetry(fn)).rejects.toBe(error);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(toast.warning).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        expect.not.stringContaining("private diagnostic"),
        expect.objectContaining({
          action: expect.objectContaining({ label: "Open AI settings" }),
        }),
      );
      const options = vi.mocked(toast.error).mock.calls[0][1];
      const action = options?.action;
      if (
        !action ||
        typeof action !== "object" ||
        !("onClick" in action) ||
        typeof action.onClick !== "function"
      )
        throw new Error("Missing Settings action");
      Reflect.apply(action.onClick, undefined, []);
      expect(useSettingsDialogStore.getState()).toMatchObject({
        open: true,
        tab: "ai",
        aiTarget: target,
      });
    },
  );

  it.each([400, 401, 402, 403, 404, 413, 422])(
    "does not retry permanent HTTP %s failures",
    async (statusCode) => {
      const error = Object.assign(new Error("private response"), {
        statusCode,
      });
      const fn = vi.fn().mockRejectedValue(error);
      await expect(withAiRetry(fn)).rejects.toBe(error);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(toast.warning).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledOnce();
    },
  );

  it.each([408, 409, 429, 500, 502, 503, 504])(
    "retries transient HTTP %s failures once",
    async (statusCode) => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error("temporary"), { statusCode }),
        )
        .mockResolvedValueOnce("ok");
      await expect(withAiRetry(fn)).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
      expect(toast.warning).toHaveBeenCalledOnce();
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it("does not retry quota exhaustion disguised as HTTP 429", async () => {
    const error = Object.assign(new Error("Too many requests"), {
      statusCode: 429,
      responseBody: JSON.stringify({ error: { code: "insufficient_quota" } }),
    });
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withAiRetry(fn)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("credits"),
      expect.anything(),
    );
  });

  it("does not present cancellation during the retry as an error", async () => {
    const abort = new DOMException("Canceled", "AbortError");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(abort);
    await expect(withAiRetry(fn)).rejects.toBe(abort);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
