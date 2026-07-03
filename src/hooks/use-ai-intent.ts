import { useEffect, useRef } from "react";
import { useAiIntentStore, type AiIntent } from "@/stores/ai-intent-store";
import type { AiTab } from "@/stores/view-store";

/** Fire `onIntent` exactly once per pending intent targeting `tab` - on mount
 *  when one is already parked, or live while mounted. Clears it after firing.
 *  onIntent is read through a ref so a fresh closure never re-fires. */
export function useAiIntent(tab: AiTab, onIntent: (intent: AiIntent) => void): void {
  const onIntentRef = useRef(onIntent);
  onIntentRef.current = onIntent;
  const pending = useAiIntentStore((s) => s.pending);

  useEffect(() => {
    if (!pending || pending.tab !== tab) return;
    // consume() clears pending, so this effect cannot re-enter for the same intent.
    const intent = useAiIntentStore.getState().consume(tab);
    if (intent) onIntentRef.current(intent);
  }, [pending, tab]);
}
