// prose-body.ts — the marker that flags a textarea as a carve-eligible prose body.
// Emitted by AutoGrowTextarea and queried by the selection toolbar + split
// shortcut, so the attribute name can't drift across the three call sites.
export const PROSE_BODY_ATTR = "data-prose-body";
export const PROSE_BODY_SELECTOR = `[${PROSE_BODY_ATTR}]`;
