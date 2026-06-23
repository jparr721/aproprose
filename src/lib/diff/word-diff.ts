// word-diff.ts -- a small word-level diff for showing before -> after edits.
//
// Tokenizes both strings into words-with-trailing-whitespace, runs a longest
// common subsequence over the tokens, then emits ordered segments. Consecutive
// ops of the same kind are merged into runs so the UI renders struck-through
// "del" and tinted "add" spans with unchanged "same" text between them.

export type DiffSegment = { type: "same" | "add" | "del"; text: string };

// Each token keeps its trailing whitespace, so re-joining tokens reproduces the
// original string exactly.
function tokenize(s: string): string[] {
  return s.match(/\S+\s*|\s+/g) ?? [];
}

export function diffWords(oldText: string, newText: string): DiffSegment[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const m = a.length;
  const n = b.length;

  // LCS length table (suffix form): dp[i][j] = LCS(a[i..], b[j..]).
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segs: DiffSegment[] = [];
  const push = (type: DiffSegment["type"], text: string) => {
    if (!text) return;
    const last = segs.at(-1);
    if (last && last.type === type) last.text += text;
    else segs.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", a[i]);
      i++;
    } else {
      push("add", b[j]);
      j++;
    }
  }
  while (i < m) push("del", a[i++]);
  while (j < n) push("add", b[j++]);
  return segs;
}
