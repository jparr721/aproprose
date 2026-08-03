// author-preferences.ts - renders and applies the author's global preferences.

import { PREFERENCE_MAX_CHARS } from "@/lib/types";

/** Voice reaches every operation; editing rules reach Writing and Edit. */
export type PreferenceScope = "voice" | "voice+editing";

export interface AuthorPreferences {
  styleGuide: string;
  editingRules: string;
}

function renderLabeledPreference(label: string, value: string): string {
  const text = value.trim().slice(0, PREFERENCE_MAX_CHARS);
  if (!text) return "";
  return `${label}:\n${text}`;
}

/** Render the author's standing writing voice as an additive labeled block. */
export function renderVoicePreference(style: string): string {
  return renderLabeledPreference(
    "AUTHOR VOICE (the author's standing style; honour it as you would the manuscript's own voice - it refines the guidance above, it does not override it)",
    style,
  );
}

/** Render the author's standing Writing/Edit rules as an additive labeled block. */
export function renderEditingPreference(editing: string): string {
  return renderLabeledPreference(
    "AUTHOR EDITING RULES (standing mechanical preferences to apply while revising; they add constraints, they do not loosen any rule above)",
    editing,
  );
}

/**
 * Append the author's preference block(s) after `base`. Voice is always added
 * (when set); editing rules are added only for the "voice+editing" scope. Empty
 * preferences contribute nothing, so an unset install returns `base` verbatim.
 */
export function authorSystem(
  base: string,
  scope: PreferenceScope,
  preferences: AuthorPreferences,
): string {
  const parts = [base, renderVoicePreference(preferences.styleGuide)];
  if (scope === "voice+editing") {
    parts.push(renderEditingPreference(preferences.editingRules));
  }
  return parts.filter(Boolean).join("\n\n");
}
