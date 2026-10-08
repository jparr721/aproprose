// author-preferences.ts - renders and applies the author's global preferences.

import { AUTHOR_AUTHORITY, type AuthorPreferences } from "@/author";

export type { AuthorPreferences } from "@/author";

export type PreferenceScope = "voice" | "voice+editing" | "evidence";

function renderLabeledPreference(label: string, value: string): string {
  const text = value.trim();
  if (!text) return "";
  return `${label}:\n${text}`;
}

export function renderVoicePreference(style: string): string {
  return renderLabeledPreference(
    "AUTHOR VOICE (declared standing voice; governs generic style advice)",
    style,
  );
}

export function renderEditingPreference(editing: string): string {
  return renderLabeledPreference(
    "AUTHOR EDITING RULES (declared drafting, revision and evaluation constraints; govern generic craft advice)",
    editing,
  );
}

export function authorSystem(
  base: string,
  scope: PreferenceScope,
  preferences: AuthorPreferences,
): string {
  const parts = [base, renderVoicePreference(preferences.styleGuide)];
  if (scope !== "voice") {
    parts.push(renderEditingPreference(preferences.editingRules));
  }
  parts.push(AUTHOR_AUTHORITY);
  if (scope === "evidence") {
    parts.push("EVIDENCE TASK: Author preferences are labeled comparison context. Preserve source facts and quoted evidence exactly; writing preferences never authorize inventing, omitting or rewriting evidence.");
  }
  return parts.filter(Boolean).join("\n\n");
}
