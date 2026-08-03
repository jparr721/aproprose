import { describe, expect, it } from "vitest";
import {
  agentFailureActionLabel,
  failureFromError,
  modelUnavailableFailure,
  modelUnselectedFailure,
} from "@/lib/ai/agent-failure";

describe("agent failure normalization", () => {
  it("gives an OpenRouter model selection a provider-specific safe action", () => {
    expect(modelUnselectedFailure("openrouter")).toEqual({
      reason: "model-unselected",
      message: "Choose a model for OpenRouter, then submit again.",
      action: "choose-model",
      settingsTarget: "model",
    });
  });

  it("uses a distinct recovery label for an unavailable selected model", () => {
    expect(agentFailureActionLabel(modelUnavailableFailure("openrouter"))).toBe(
      "Choose another model",
    );
  });

  it.each([
    [
      "missing key",
      { name: "AiConfigFailure", failure: { reason: "key-missing" } },
      "key-missing",
    ],
    [
      "rejected key",
      Object.assign(new Error("Unauthorized"), { status: 401 }),
      "key-rejected",
    ],
    [
      "unavailable model",
      new Error("No context-window metadata for model: private-model"),
      "model-unavailable",
    ],
    [
      "quota",
      Object.assign(new Error("insufficient_quota"), { status: 402 }),
      "quota",
    ],
    [
      "transport",
      Object.assign(new Error("provider unavailable"), { status: 503 }),
      "transport",
    ],
    [
      "compaction retains quota cause",
      Object.assign(new Error("insufficient_quota"), { status: 402 }),
      "quota",
    ],
  ])("normalizes %s without exposing raw detail", (_case, error, reason) => {
    const failure = failureFromError(
      error,
      "openai",
      _case === "compaction retains quota cause" ? "compaction" : null,
    );

    expect(failure.reason).toBe(reason);
    expect(failure.message).not.toContain("private-model");
    expect(failure.message).not.toContain("insufficient_quota");
  });
});
