// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferenceAssistant } from "@/components/app/settings/preference-assistant";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { refinePreference, type PreferenceField } from "@/lib/ai/refine-preference";
import { useSettingsDialogStore } from "@/stores/settings-dialog-store";
import { useSettingsStore } from "@/stores/settings-store";

vi.mock("@/lib/ai/refine-preference", () => ({ refinePreference: vi.fn() }));

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(refinePreference).mockReset().mockResolvedValue("Third person, past tense. Preserve technical diction.");
  useSettingsStore.setState({
    aiProvider: "openai",
    aiModel: "gpt-5-mini",
    styleGuide: "Dark voice. Third person.",
    editingRules: "Cut filler. Keep technical words.",
  });
  useSettingsDialogStore.setState({ open: false, aiTarget: null });
});

function openAssistant(field: PreferenceField): void {
  render(<PreferenceAssistant field={field} keyConfigured />);
  fireEvent.click(screen.getByRole("button", { name: /AI help for/ }));
}

describe("PreferenceAssistant", () => {
  it.each(["styleGuide", "editingRules"] as const)("generates from existing %s text when its AI button is clicked", async (field) => {
    const current = useSettingsStore.getState()[field];
    openAssistant(field);

    await screen.findByRole("textbox", { name: "Suggested preference" });
    expect(refinePreference).toHaveBeenCalledExactlyOnceWith(
      { field, current, request: "" },
      { provider: "openai", modelId: "gpt-5-mini", signal: expect.any(AbortSignal) },
    );
    expect(useSettingsStore.getState()[field]).toBe(current);
  });

  it.each(["styleGuide", "editingRules"] as const)("reviews %s locally and applies only that field", async (field) => {
    const before = useSettingsStore.getState();
    openAssistant(field);
    await screen.findByRole("textbox", { name: "Suggested preference" });
    fireEvent.change(screen.getByRole("textbox", { name: "Your intent" }), {
      target: { value: "Preserve technical diction and clarify perspective." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate suggestion" }));

    await screen.findByRole("textbox", { name: "Suggested preference" });
    expect(useSettingsStore.getState().styleGuide).toBe(before.styleGuide);
    expect(useSettingsStore.getState().editingRules).toBe(before.editingRules);
    expect(refinePreference).toHaveBeenCalledWith(
      { field, current: before[field], request: "Preserve technical diction and clarify perspective." },
      { provider: "openai", modelId: "gpt-5-mini", signal: expect.any(AbortSignal) },
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply suggestion" }));

    expect(useSettingsStore.getState()[field]).toBe("Third person, past tense. Preserve technical diction.");
    const otherField = field === "styleGuide" ? "editingRules" : "styleGuide";
    expect(useSettingsStore.getState()[otherField]).toBe(before[otherField]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("requires author intent when the preference is blank", async () => {
    useSettingsStore.setState({ styleGuide: "" });
    openAssistant("styleGuide");
    expect(screen.getByRole("button", { name: "Generate suggestion" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Your intent" }), {
      target: { value: "Use warm, precise narration." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate suggestion" }));
    await screen.findByRole("textbox", { name: "Suggested preference" });
    expect(vi.mocked(refinePreference).mock.calls[0][0].current).toBe("");
  });

  it("cancels an in-flight request and ignores its result after reopening", async () => {
    let finish: (value: string) => void = () => { throw new Error("Generation has not started"); };
    vi.mocked(refinePreference).mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    openAssistant("styleGuide");
    const signal = vi.mocked(refinePreference).mock.calls[0][1].signal;
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(signal.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /AI help for/ }));
    await act(async () => { finish("Obsolete response"); });
    const reopened = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Suggested preference" });
    expect(reopened.value).toBe("Third person, past tense. Preserve technical diction.");
    expect(useSettingsStore.getState().styleGuide).toBe("Dark voice. Third person.");
  });

  it("discards a reviewed suggestion on Cancel", async () => {
    openAssistant("editingRules");
    await screen.findByRole("textbox", { name: "Suggested preference" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useSettingsStore.getState().editingRules).toBe("Cut filler. Keep technical words.");
  });

  it("protects manual edits made while generation is in flight", async () => {
    let finish: (value: string) => void = () => { throw new Error("Generation has not started"); };
    vi.mocked(refinePreference).mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    openAssistant("styleGuide");
    await act(async () => {
      useSettingsStore.getState().setStyleGuide("The author's newer voice.");
      finish("Stale voice");
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Your text changed");
    expect(screen.getByRole("button", { name: "Apply suggestion" }).hasAttribute("disabled")).toBe(true);
    expect(useSettingsStore.getState().styleGuide).toBe("The author's newer voice.");
  });

  it("checks live settings synchronously at Apply before React re-renders", async () => {
    openAssistant("styleGuide");
    await screen.findByRole("textbox", { name: "Suggested preference" });
    act(() => {
      useSettingsStore.getState().setStyleGuide("Latest voice");
      fireEvent.click(screen.getByRole("button", { name: "Apply suggestion" }));
    });
    expect(useSettingsStore.getState().styleGuide).toBe("Latest voice");
    expect(screen.getByRole("alert").textContent).toContain("changed");
  });

  it("aborts and clears a request when the selected provider changes", async () => {
    vi.mocked(refinePreference).mockImplementationOnce(() => new Promise<string>(() => {}));
    openAssistant("styleGuide");
    const signal = vi.mocked(refinePreference).mock.calls[0][1].signal;
    act(() => { useSettingsStore.getState().setAiProvider("openrouter"); });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("button", { name: "Generating" })).toBeNull();
    expect(screen.getByText("Choose a model to use AI help.")).toBeTruthy();
  });

  it("allows editing the suggestion and refuses a blank replacement", async () => {
    openAssistant("styleGuide");
    const suggestion = await screen.findByRole("textbox", { name: "Suggested preference" });
    fireEvent.change(suggestion, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Apply suggestion" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(suggestion, { target: { value: "  Precise narration.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestion" }));
    expect(useSettingsStore.getState().styleGuide).toBe("Precise narration.");
  });

  it("surfaces provider failure safely and lets the author retry", async () => {
    vi.mocked(refinePreference).mockRejectedValueOnce(Object.assign(new Error("invalid api key at /private/config"), { statusCode: 401 }));
    openAssistant("editingRules");
    expect((await screen.findByRole("alert")).textContent).not.toContain("/private/config");
    expect(screen.getByRole("button", { name: "Open AI settings" })).toBeTruthy();
    expect(useSettingsStore.getState().editingRules).toBe("Cut filler. Keep technical words.");
    fireEvent.change(screen.getByRole("textbox", { name: "Your intent" }), { target: { value: "Keep precision" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate suggestion" }));
    await screen.findByRole("textbox", { name: "Suggested preference" });
    expect(vi.mocked(refinePreference).mock.calls[1][0].request).toBe("Keep precision");
  });

  it("routes missing model recovery to AI settings without generating", () => {
    useSettingsStore.setState({ aiModel: null });
    openAssistant("styleGuide");
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    expect(useSettingsDialogStore.getState().aiTarget).toBe("model");
    expect(refinePreference).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("routes a missing key to AI settings", () => {
    render(<PreferenceAssistant field="styleGuide" keyConfigured={false} />);
    fireEvent.click(screen.getByRole("button", { name: /AI help for/ }));
    fireEvent.click(screen.getByRole("button", { name: "Configure key" }));
    expect(useSettingsDialogStore.getState().aiTarget).toBe("key");
    expect(refinePreference).not.toHaveBeenCalled();
  });

  it("closes only the nested assistant with Escape and restores trigger focus", async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <PreferenceAssistant field="styleGuide" keyConfigured />
        </DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: /AI help for/ });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(2));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    expect(screen.getByText("Settings")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
