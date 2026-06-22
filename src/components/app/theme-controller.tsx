// theme-controller.tsx — applies appearance settings to the document.
//
// Renders nothing; it just reflects the settings store onto <html>: the
// data-theme attribute (drives light/sepia/dark + the PDF "paper" scoping) and
// the `.dark` class (so shadcn's dark variant fires), plus the --prose-size CSS
// variable the editor reads. Per CLAUDE.md, the dynamic value goes through a CSS
// variable rather than an inline style object.

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";

export function ThemeController() {
  const theme = useSettingsStore((s) => s.theme);
  const proseSize = useSettingsStore((s) => s.proseSize);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--prose-size", `${proseSize}px`);
  }, [proseSize]);

  return null;
}
