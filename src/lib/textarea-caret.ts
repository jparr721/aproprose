// textarea-caret.ts — locate a <textarea> selection on screen.
//
// The DOM Selection API ignores text inside a <textarea>, so to anchor the
// selection toolbar above the highlight we mirror the textarea into a hidden div
// with identical styling, place a marker span at the selection, and read its
// box. Based on the well-known textarea-caret-position technique.

const MIRRORED_PROPERTIES = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "whiteSpace",
  "wordWrap",
  "wordBreak",
] as const;

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Viewport-relative rect spanning the textarea selection [start, end].
 * Returns null if the textarea isn't in a laid-out document.
 */
export function selectionRect(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
): DOMRect | null {
  const doc = textarea.ownerDocument;
  const win = doc.defaultView;
  if (!win) return null;

  const div = doc.createElement("div");
  const style = div.style;
  const computed = win.getComputedStyle(textarea);

  style.position = "absolute";
  style.top = "0";
  style.left = "-9999px";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.overflow = "hidden";
  style.height = "auto";
  for (const prop of MIRRORED_PROPERTIES) {
    const name = kebab(prop);
    style.setProperty(name, computed.getPropertyValue(name));
  }

  div.textContent = textarea.value.slice(0, start);
  const marker = doc.createElement("span");
  // Non-empty so it has a measurable box even for a collapsed selection.
  marker.textContent = textarea.value.slice(start, end) || ".";
  div.appendChild(marker);
  doc.body.appendChild(div);

  const top = marker.offsetTop;
  const left = marker.offsetLeft;
  const height = marker.offsetHeight;
  const width = marker.offsetWidth;
  doc.body.removeChild(div);

  const taRect = textarea.getBoundingClientRect();
  return new DOMRect(
    taRect.left + left - textarea.scrollLeft,
    taRect.top + top - textarea.scrollTop,
    width,
    height,
  );
}
