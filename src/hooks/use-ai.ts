import { useCallback, useRef } from "react";
import { useAiCacheStore } from "@/stores/ai-cache-store";
import { describeAiError } from "@/lib/ai/errors";

/**
 * Cache-backed, manual async result. Idle-first: a request fires only on an
 * explicit run(instruction?) (a tab's composer submit / Try again). Results live
 * in the shared ai-cache-store keyed by `cacheKey`, so they survive remounts and
 * (via ai-persistence) app restarts; a new key (different scene / cursor) reads
 * as idle. `op` is read through a ref so each run uses the latest closure while
 * `run` stays memoised on `cacheKey` -- moving the cursor mid-flight can never
 * land a stale result against the new anchor; the in-flight run just populates
 * the old key. The instruction that produced a result is stored on the entry so
 * a remounted tab can caption it.
 */
export function useAi<T>(op: (instruction?: string) => Promise<T>, cacheKey: string) {
  const entry = useAiCacheStore((s) => s.entries[cacheKey]);
  const patch = useAiCacheStore((s) => s.patch);
  const opRef = useRef(op);
  opRef.current = op;

  const run = useCallback(
    (instruction?: string) => {
      patch(cacheKey, { loading: true, error: null, instruction });
      opRef
        .current(instruction)
        .then((d) => patch(cacheKey, { data: d, loading: false, error: null }))
        .catch((e) => patch(cacheKey, { loading: false, error: describeAiError(e) }));
    },
    [cacheKey, patch],
  );

  return {
    // The cache stores `data` as `unknown`; this cast is sound because only this
    // hook writes `cacheKey`, and it only writes the `T` its own `op` produced.
    data: (entry?.data ?? null) as T | null,
    loading: entry?.loading ?? false,
    error: entry?.error ?? null,
    instruction: entry?.instruction,
    run,
  };
}