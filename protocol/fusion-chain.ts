/** A fusion step may omit its cutoff to use its full input window. */
export type TFusionEntry = { readonly cutoff_tokens?: number };
export type TFusionWindowOf<T> = (entry: T) => number;

/** Stable ascending input-window order; equal windows retain their original order. */
export function sortChainForFusion<T>(
  entries: readonly T[],
  windowOf: TFusionWindowOf<T>,
): T[] {
  return entries
    .map((entry, index) => ({ entry, index, window: windowOf(entry) }))
    .sort((a, b) => a.window - b.window || a.index - b.index)
    .map(({ entry }) => entry);
}

/** Clamp cutoffs after sorting. The last step's stored cutoff is left untouched. */
export function normalizeFusionCutoffs<T extends TFusionEntry>(
  entries: readonly T[],
  windowOf: TFusionWindowOf<T>,
): T[] {
  let previous = 0;
  return entries.map((entry, index) => {
    if (index === entries.length - 1) return entry;
    const window = windowOf(entry);
    const cutoff = Math.min(
      window,
      Math.max(previous, entry.cutoff_tokens ?? window),
    );
    previous = cutoff;
    return { ...entry, cutoff_tokens: cutoff };
  });
}

/** Choose a starting step; an empty chain has no step and returns -1. */
export function fusionStartIndex<T extends TFusionEntry>(
  entries: readonly T[],
  windowOf: TFusionWindowOf<T>,
  inputTokens: number,
): number {
  if (entries.length === 0) return -1;
  for (let index = 0; index < entries.length - 1; index++) {
    const entry = entries[index];
    if (
      entry !== undefined &&
      inputTokens < (entry.cutoff_tokens ?? windowOf(entry))
    )
      return index;
  }
  return entries.length - 1;
}
