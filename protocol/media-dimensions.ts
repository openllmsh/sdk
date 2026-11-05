/**
 * Generic media-dimension arithmetic and accepted-set helpers.
 *
 * This module is deliberately FACT-FREE. It holds no provider's
 * durations, ratios, resolution tiers or counts — those are catalog-
 * owned data on a model card (`ModelCaps.media*`), because they drift
 * with a vendor's fleet and a constant here would silently apply a
 * today-model's limits to tomorrow's. What lives here is only the
 * arithmetic every media lane would otherwise re-implement: parsing a
 * `WIDTHxHEIGHT` size, reducing it to a ratio, labelling its short
 * edge, matching it against a declared vocabulary, and rendering an
 * accepted set for an error message.
 *
 * The request SHAPE (which JSON field carries image bytes, how
 * instances/parameters nest) stays in the protocol wire schemas — that
 * is structure, not a per-model fact.
 *
 * Consumers take the VALUE SETS from resolved caps and pass them in. A
 * set that is absent means UNKNOWN: the value is forwarded and the
 * provider's own error is the authority. Nothing here clamps or
 * rewrites a caller's request.
 */

/** Parsed `WIDTHxHEIGHT` dimensions. */
export type TMediaDimensions = {
  readonly width: number;
  readonly height: number;
};

/** One documented resolution tier: a name and its published long edge. */
export type TMediaResolutionTier = {
  readonly resolution: string;
  readonly longEdge: number;
};

/** Parse a canonical `WIDTHxHEIGHT` size; null when it is not that shape. */
export const parseMediaDimensions = (size: string): TMediaDimensions | null => {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (match === null) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  return { width, height };
};

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Reduce dimensions to their `W:H` ratio (1280x720 → "16:9"). */
export const aspectRatioFromDimensions = (
  dimensions: TMediaDimensions,
): string => {
  const divisor = gcd(dimensions.width, dimensions.height);
  return `${dimensions.width / divisor}:${dimensions.height / divisor}`;
};

/** Short-edge resolution label (720x1280 → "720p"; 3840x2160 → "4k"). */
export const resolutionFromDimensions = (
  dimensions: TMediaDimensions,
): string => {
  const shortEdge = Math.min(dimensions.width, dimensions.height);
  return shortEdge === 2160 ? "4k" : `${shortEdge}p`;
};

/**
 * Match dimensions against a provider's DECLARED aspect-ratio
 * vocabulary by value, and return the provider's own spelling.
 *
 * A vendor may publish non-integer ratios (`9:19.5`), which a gcd
 * reduction can never produce: 1080x2340 reduces to `6:13`, the same
 * ratio as a declared `9:19.5`. Comparing numerically keeps the
 * caller's framing instead of refusing an aspect the provider accepts.
 */
export const matchDeclaredAspectRatio = (
  allowed: ReadonlyArray<string>,
  dimensions: TMediaDimensions,
): string | null => {
  const requested = dimensions.width / dimensions.height;
  for (const declared of allowed) {
    const [width, height] = declared.split(":").map(Number);
    if (
      width === undefined ||
      height === undefined ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      height === 0
    )
      continue;
    // Tolerance covers the rounding in published one-decimal ratios.
    if (Math.abs(width / height - requested) <= 1e-3) return declared;
  }
  return null;
};

/**
 * The tier whose documented long edge the request matches EXACTLY.
 *
 * Deliberately not a nearest/covering heuristic: "smallest tier that
 * covers it" promotes a size to a pricier tier and demotes another into
 * an upscale, neither of which the caller asked for. A long edge with no
 * documented tier returns null so the adapter can say so by name.
 */
export const resolutionTierForLongEdge = (
  tiers: ReadonlyArray<TMediaResolutionTier>,
  longEdge: number,
  allowed?: ReadonlyArray<string>,
): string | null =>
  tiers.find(
    (tier) =>
      longEdge === tier.longEdge &&
      (allowed === undefined || allowed.includes(tier.resolution)),
  )?.resolution ?? null;

/**
 * Membership against a declared set. An UNDEFINED set means the catalog
 * knows nothing about this model, so the value passes through — only a
 * present set can refuse.
 */
export const isAllowedMediaOption = (
  allowed: ReadonlyArray<string> | undefined,
  value: string,
): boolean => allowed === undefined || allowed.includes(value);

/** Render an allowed set for a corrective, non-clamping error message. */
export const describeAllowed = (
  allowed: ReadonlyArray<string | number>,
): string => allowed.map((value) => String(value)).join(", ");
