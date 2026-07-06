// author-preferences.ts - composes a base system prompt with the author's global
// preferences read from settings. Kept out of prompts.ts so that module stays
// pure: the render helpers there do the formatting, this reads live state (the
// same getState() pattern model.ts uses to read the provider/model).

import { useSettingsStore } from "@/stores/settings-store";
import { renderVoicePreference, renderEditingPreference } from "@/lib/ai/prompts";

/** Voice reaches every op; editing rules additionally reach Edit and Muse. */
export type PreferenceScope = "voice" | "voice+editing";

/**
 * Append the author's preference block(s) after `base`. Voice is always added
 * (when set); editing rules are added only for the "voice+editing" scope. Empty
 * preferences contribute nothing, so an unset install returns `base` verbatim.
 */
export function authorSystem(base: string, scope: PreferenceScope): string {
  const { styleGuide, editingRules } = useSettingsStore.getState();
  const parts = [base, renderVoicePreference(styleGuide)];
  if (scope === "voice+editing") {
    parts.push(renderEditingPreference(editingRules));
  }
  return parts.filter(Boolean).join("\n\n");
}
