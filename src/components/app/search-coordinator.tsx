import { useEffect } from "react";
import { useKeybinding } from "@/hooks/use-keybinding";
import { KEYBINDING_IDS } from "@/lib/keybindings";
import { useSearchSurfaceStore } from "@/stores/search-surface-store";

export function SearchCoordinator({ pdfAvailable }: { pdfAvailable: boolean }): null {
  const removePdf = useSearchSurfaceStore((state) => state.removePdf);

  useKeybinding(KEYBINDING_IDS.OPEN_FIND, () => {
    useSearchSurfaceStore.getState().openActive();
  });

  useEffect(() => {
    if (!pdfAvailable) removePdf();
  }, [pdfAvailable, removePdf]);

  return null;
}
