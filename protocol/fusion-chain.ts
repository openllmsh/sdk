/** A fusion step may omit its cutoff to use its full input window. */
export type TFusionEntry = { readonly cutoff_tokens?: number };
export type TFusionWindowOf<T> = (entry: T) => number;

/**
 * Stable ascending hand-off order: a step's cutoff (its window when unset,
 * never above it), so a 1M model handing off at 50k leads a 250k model.
 * Equal hand-offs retain their original order.
 */
export function sortChainForFusion<T extends TFusionEntry>(
  entries: readonly T[],
  windowOf: TFusionWindowOf<T>,
): T[] {
  return entries
    .map((entry, index) => {
      const window = windowOf(entry);
      const handOff = Math.min(window, entry.cutoff_tokens ?? window);
      return { entry, index, handOff };
    })
    .sort((a, b) => a.handOff - b.handOff || a.index - b.index)
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
