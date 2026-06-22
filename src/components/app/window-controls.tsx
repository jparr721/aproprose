// window-controls.tsx — custom minimize/maximize/close for the frameless window
// on Windows/Linux. macOS uses native traffic lights (titleBarStyle: Overlay),
// so this renders nothing there. Tauri IPC calls are .catch-guarded so the
// non-Tauri browser preview (`just dev`) doesn't throw unhandled rejections.

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconCopy, IconMinus, IconSquare, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { IS_MAC } from "@/lib/platform";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (IS_MAC) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized).catch(() => {});
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  if (IS_MAC) return null;

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Minimize"
        onClick={() => void getCurrentWindow().minimize()}
      >
        <IconMinus />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {maximized ? <IconCopy /> : <IconSquare />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close"
        className="hover:bg-destructive hover:text-destructive-foreground"
        onClick={() => void getCurrentWindow().close()}
      >
        <IconX />
      </Button>
    </div>
  );
}
