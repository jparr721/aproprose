import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  refinePreference,
  type PreferenceField,
  type RefinePreferenceInput,
  type RefinePreferenceOptions,
} from "@/lib/ai/refine-preference";
import { PREFERENCE_MAX_CHARS, type AiProvider } from "@/lib/types";

interface GenerationRequest {
  model: LanguageModel;
  system: string;
  prompt: string;
  output: unknown;
  abortSignal: AbortSignal;
  maxRetries: number;
}

const mocks = vi.hoisted(() => ({
  getModel: vi.fn<(provider: AiProvider, modelId: string) => Promise<LanguageModel>>(),
  generateText: vi.fn<(request: GenerationRequest) => Promise<{ output: unknown }>>(),
  warning: vi.fn<typeof import("sonner").toast.warning>(),
  error: vi.fn<typeof import("sonner").toast.error>(),
}));

vi.mock("ai", async (importOriginal) => {
  const original: typeof import("ai") = await importOriginal<typeof import("ai")>();
  return { ...original, generateText: mocks.generateText };
});

vi.mock("@/lib/ai/model", () => ({ getModel: mocks.getModel }));

vi.mock("sonner", () => ({ toast: { warning: mocks.warning, error: mocks.error } }));

const model: LanguageModel = new MockLanguageModelV3();

function options(signal: AbortSignal): RefinePreferenceOptions {
  return { provider: "openrouter", modelId: "selected-model", signal };
}

const existingPreference: RefinePreferenceInput = {
  field: "styleGuide",
  current: "Direct, spare prose. Never use 'suddenly'. Keep deliberate fragments.",
  request: "Make these preferences clearer without adding restrictions.",
};

beforeEach(() => {
  mocks.getModel.mockReset().mockResolvedValue(model);
  mocks.generateText.mockReset().mockResolvedValue({
    output: { text: "Use direct, spare prose. Preserve deliberate fragments." },
  });
  mocks.warning.mockReset();
  mocks.error.mockReset();
});

describe("refinePreference", () => {
  it("rejects missing author intent before resolving a model", async () => {
    await expect(
      refinePreference(
        { field: "styleGuide", current: " \n\t", request: " \n" },
        options(new AbortController().signal),
      ),
    ).rejects.toThrow("Provide an existing preference or describe what you want.");

    expect(mocks.getModel).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it.each(["openai", "openrouter"] satisfies AiProvider[])(
    "uses the selected %s provider and model with the caller's signal",
    async (provider) => {
      const controller: AbortController = new AbortController();

      await refinePreference(existingPreference, {
        provider,
        modelId: "author-selected-model",
        signal: controller.signal,
      });

      expect(mocks.getModel).toHaveBeenCalledExactlyOnceWith(
        provider,
        "author-selected-model",
      );
      expect(mocks.generateText).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          model,
          abortSignal: controller.signal,
          maxRetries: 0,
        }),
      );
    },
  );

  it.each([
    { field: "styleGuide", label: "Writing voice", scope: "every AI response" },
    {
      field: "editingRules",
      label: "Writing and editing instructions",
      scope: "Writing and Edit",
    },
  ] satisfies Array<{ field: PreferenceField; label: string; scope: string }>)(
    "labels $label and preserves exact source/request data outside the system prompt",
    async ({ field, label, scope }) => {
      const current: string = "  Never use 'suddenly'.\nKeep intentional fragments.  ";
      const request: string = "Clarify this. Preserve my exceptions and examples.";

      await refinePreference(
        { field, current, request },
        options(new AbortController().signal),
      );

      const call: GenerationRequest = mocks.generateText.mock.calls[0][0];
      expect(call.prompt).toContain(label);
      expect(call.prompt).toContain("CURRENT PREFERENCE (author-supplied data):");
      expect(call.prompt).toContain(JSON.stringify(current));
      expect(call.prompt).toContain("AUTHOR REQUEST (author-supplied data):");
      expect(call.prompt).toContain(JSON.stringify(request));
      expect(call.system).toContain(scope);
      expect(call.system).toContain("every explicit constraint, exclusion, example, and exception");
      expect(call.system).toContain("Do not invent goals, preferences, or examples");
      expect(call.system).toContain("ASCII punctuation");
      expect(call.system).not.toContain(current);
      expect(call.system).not.toContain(request);
      expect(call.system).not.toContain("AUTHOR VOICE");
      expect(call.system).not.toContain("AUTHOR EDITING RULES");
    },
  );

  it("can define an empty preference from the author's request", async () => {
    await expect(
      refinePreference(
        { field: "styleGuide", current: "", request: "Spare and direct, without ornate metaphors." },
        options(new AbortController().signal),
      ),
    ).resolves.toBe("Use direct, spare prose. Preserve deliberate fragments.");
  });

  it("can clarify existing text without an additional request", async () => {
    await expect(
      refinePreference(
        { field: "editingRules", current: "Keep fragments. Cut throat-clearing.", request: "" },
        options(new AbortController().signal),
      ),
    ).resolves.toBe("Use direct, spare prose. Preserve deliberate fragments.");
  });

  it("trims the result and accepts the full preference limit without truncation", async () => {
    const text: string = "x".repeat(PREFERENCE_MAX_CHARS);
    mocks.generateText.mockResolvedValue({ output: { text: ` \n${text}\n ` } });

    await expect(
      refinePreference(existingPreference, options(new AbortController().signal)),
    ).resolves.toBe(text);
  });

  it.each([
    { name: "missing output", output: undefined },
    { name: "null output", output: null },
    { name: "missing text", output: {} },
    { name: "non-string text", output: { text: 42 } },
    { name: "empty text", output: { text: "" } },
    { name: "whitespace-only text", output: { text: " \n\t " } },
    { name: "oversized text", output: { text: "x".repeat(PREFERENCE_MAX_CHARS + 1) } },
  ] satisfies Array<{ name: string; output: unknown }>)(
    "rejects $name without retrying when SDK validation is bypassed",
    async ({ output }) => {
      mocks.generateText.mockResolvedValue({ output });

      await expect(
        refinePreference(existingPreference, options(new AbortController().signal)),
      ).rejects.toBeInstanceOf(ZodError);

      expect(mocks.generateText).toHaveBeenCalledOnce();
      expect(mocks.warning).not.toHaveBeenCalled();
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
        "The AI request could not be completed. Retry the request.",
        { id: "ai-request-error", action: undefined },
      );
    },
  );

  it("retries once with the same frozen input, model, and signal", async () => {
    const controller: AbortController = new AbortController();
    const input: RefinePreferenceInput = { ...existingPreference };
    const selected: RefinePreferenceOptions = options(controller.signal);
    mocks.generateText
      .mockImplementationOnce(async () => {
        input.field = "editingRules";
        input.current = "Changed while waiting.";
        input.request = "A different request.";
        selected.provider = "openai";
        selected.modelId = "different-model";
        selected.signal = new AbortController().signal;
        throw Object.assign(new Error("provider temporarily unavailable"), { statusCode: 503 });
      })
      .mockResolvedValueOnce({ output: { text: "Retained author intent." } });

    await expect(refinePreference(input, selected)).resolves.toBe("Retained author intent.");

    expect(mocks.getModel).toHaveBeenCalledExactlyOnceWith("openrouter", "selected-model");
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    const first: GenerationRequest = mocks.generateText.mock.calls[0][0];
    const second: GenerationRequest = mocks.generateText.mock.calls[1][0];
    expect(first.prompt).toContain(JSON.stringify(existingPreference.current));
    expect(first.prompt).not.toContain("Changed while waiting.");
    expect(second.prompt).toBe(first.prompt);
    expect(second.system).toBe(first.system);
    expect(second.model).toBe(first.model);
    expect(second.abortSignal).toBe(controller.signal);
    expect(second.maxRetries).toBe(0);
    expect(mocks.warning).toHaveBeenCalledExactlyOnceWith(
      "Your AI provider is temporarily unavailable. Retry shortly.",
      { id: "ai-request-retry", description: "Retrying once." },
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("keeps the last failure after the single retry", async () => {
    const last: Error = Object.assign(new Error("provider is still unavailable"), { statusCode: 503 });
    mocks.generateText
      .mockRejectedValueOnce(new Error("network connection lost"))
      .mockRejectedValueOnce(last);

    await expect(
      refinePreference(existingPreference, options(new AbortController().signal)),
    ).rejects.toBe(last);

    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.warning).toHaveBeenCalledExactlyOnceWith(
      "The AI request could not be completed. Check your connection and retry.",
      { id: "ai-request-retry", description: "Retrying once." },
    );
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      "Your AI provider is temporarily unavailable. Retry shortly.",
      { id: "ai-request-error", action: undefined },
    );
  });

  it("does not retry rejected credentials and preserves the original error", async () => {
    const failure: Error = Object.assign(new Error("unauthorized private provider detail"), { statusCode: 401 });
    mocks.generateText.mockRejectedValueOnce(failure);

    await expect(
      refinePreference(existingPreference, options(new AbortController().signal)),
    ).rejects.toBe(failure);

    expect(mocks.generateText).toHaveBeenCalledOnce();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      "Replace the AI provider key, then submit again.",
      {
        id: "ai-request-error",
        action: { label: "Open AI settings", onClick: expect.any(Function) },
      },
    );
  });

  it("does not generate when model resolution fails", async () => {
    const failure: Error = new Error("selected provider key is missing");
    mocks.getModel.mockRejectedValue(failure);

    await expect(
      refinePreference(existingPreference, options(new AbortController().signal)),
    ).rejects.toBe(failure);

    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("freezes the field and input before asynchronous model resolution", async () => {
    const input: RefinePreferenceInput = { ...existingPreference };
    const selected: RefinePreferenceOptions = options(new AbortController().signal);
    const originalSignal: AbortSignal = selected.signal;
    mocks.getModel.mockImplementationOnce(async () => {
      input.field = "editingRules";
      input.current = "A new value.";
      input.request = "A new request.";
      selected.signal = new AbortController().signal;
      return model;
    });

    await refinePreference(input, selected);

    const call: GenerationRequest = mocks.generateText.mock.calls[0][0];
    expect(call.prompt).toContain("Writing voice");
    expect(call.prompt).toContain(JSON.stringify(existingPreference.current));
    expect(call.prompt).toContain(JSON.stringify(existingPreference.request));
    expect(call.abortSignal).toBe(originalSignal);
  });

  it("rejects an already aborted request before model resolution", async () => {
    const controller: AbortController = new AbortController();
    controller.abort();

    await expect(refinePreference(existingPreference, options(controller.signal)))
      .rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.getModel).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("rejects cancellation during model resolution before generation", async () => {
    const controller: AbortController = new AbortController();
    mocks.getModel.mockImplementationOnce(async () => {
      controller.abort();
      return model;
    });

    await expect(refinePreference(existingPreference, options(controller.signal)))
      .rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("discards a response that arrives after cancellation", async () => {
    const controller: AbortController = new AbortController();
    mocks.generateText.mockImplementationOnce(async () => {
      controller.abort();
      return { output: { text: "This draft must be discarded." } };
    });

    await expect(refinePreference(existingPreference, options(controller.signal)))
      .rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.generateText).toHaveBeenCalledOnce();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("does not retry a transport rejection caused by cancellation", async () => {
    const controller: AbortController = new AbortController();
    mocks.generateText.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error("connection closed");
    });

    await expect(refinePreference(existingPreference, options(controller.signal)))
      .rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.generateText).toHaveBeenCalledOnce();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("does not retry an SDK abort error", async () => {
    mocks.generateText.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));

    await expect(
      refinePreference(existingPreference, options(new AbortController().signal)),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.generateText).toHaveBeenCalledOnce();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
