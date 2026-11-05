/**
 * Semver comparison for vendor CLI versions reported by the daemon.
 *
 * Versions arrive as whatever the CLI prints (`codex-cli 0.142.0`), so the
 * x.y.z is extracted rather than assumed to be the whole string. Shared by
 * the cloud (model-cache write guard), the dashboard (update notices), and
 * the daemon — providers can gate model visibility by client version
 * (Codex does), so version comparison is protocol-level, not app-local.
 *
 * Daemon binary floors (subscription-provider compatibility) need full
 * SemVer §11 prerelease precedence — see {@link compareDaemonSemver}. The
 * CLI helpers below deliberately keep extracting bare `x.y.z` so a noisy
 * vendor banner never invents a prerelease channel.
 */

/**
 * The bare `x.y.z` inside whatever the CLI (or a GitHub release tag) prints —
 * `codex-cli 0.142.0`, `v0.142.0`. Null when there is no semver to find, or
 * the input isn't a string (a release tag arrives as `unknown` from JSON).
 */
export const extractSemver = (version: unknown): string | null => {
  if (typeof version !== "string") return null;
  return version.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
};

const parseSemver = (version: string): readonly number[] | null => {
  const match = extractSemver(version);
  if (match === null) return null;
  return match.split(".").map((part) => Number.parseInt(part, 10));
};

/** `-1` / `0` / `1`, or null when either side carries no parseable semver. */
export const compareSemver = (left: string, right: string): number | null => {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  if (leftParts === null || rightParts === null) return null;
  const length = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < length; i += 1) {
    const leftPart = leftParts[i] ?? 0;
    const rightPart = rightParts[i] ?? 0;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
};

/** True only when both parse AND `current` is strictly behind `latest`. */
export const isOlderSemver = (current: string, latest: string): boolean =>
  compareSemver(current, latest) === -1;

/**
 * True only when both parse AND `current`'s `major.minor` is strictly
 * behind `latest`'s — the patch component is ignored, so a patch-only
 * lag (0.144.0 vs 0.144.1) is NOT "behind". Used for update notices:
 * patch bumps are too noisy to nag about.
 */
export const isMinorBehind = (current: string, latest: string): boolean => {
  const currentParts = extractSemver(current)?.split(".");
  const latestParts = extractSemver(latest)?.split(".");
  if (currentParts === undefined || latestParts === undefined) return false;
  const currentMinor = `${currentParts[0]}.${currentParts[1]}.0`;
  const latestMinor = `${latestParts[0]}.${latestParts[1]}.0`;
  return compareSemver(currentMinor, latestMinor) === -1;
};

/** Source / custom daemon build — never treated as a released floor pin. */
export const DEV_DAEMON_VERSION = "0.0.0-dev";

/** Canonical numeric identifier: `0` or no-leading-zero digits. */
const CANONICAL_NUMERIC_ID = /^(0|[1-9]\d*)$/;
/** SemVer alphanumeric identifier: nonempty, [0-9A-Za-z-], not purely numeric. */
const ALPHANUMERIC_ID = /^[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*$/;

export type TDaemonSemver = {
  /** Digit strings — compared by length then lexicographically (§11 / no Number). */
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly pre: readonly string[] | null;
};

const compareDigitIds = (left: string, right: string): -1 | 0 | 1 => {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const isValidPreIdentifier = (id: string): boolean =>
  CANONICAL_NUMERIC_ID.test(id) || ALPHANUMERIC_ID.test(id);

/**
 * Parse a daemon binary version stamp (`2.7.5`, `v2.8.0-alpha.0`). Null when
 * the input is missing or not canonical SemVer (unlike {@link extractSemver},
 * prerelease identifiers are preserved and validated — no leading zeros,
 * nonempty identifiers). Invalid stamps fall through to live capability
 * probes via {@link subscriptionProviderSupportedOnDaemon}.
 */
export const parseDaemonSemver = (version: unknown): TDaemonSemver | null => {
  if (typeof version !== "string") return null;
  const trimmed = version.trim();
  if (trimmed.length === 0) return null;
  const match = trimmed.match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/,
  );
  if (match === null) return null;
  const major = match[1] ?? "";
  const minor = match[2] ?? "";
  const patch = match[3] ?? "";
  if (
    !CANONICAL_NUMERIC_ID.test(major) ||
    !CANONICAL_NUMERIC_ID.test(minor) ||
    !CANONICAL_NUMERIC_ID.test(patch)
  ) {
    return null;
  }
  const build = match[5];
  if (build !== undefined) {
    const buildIds = build.split(".");
    if (buildIds.some((id) => id.length === 0 || !/^[0-9A-Za-z-]+$/.test(id))) {
      return null;
    }
  }
  let pre: readonly string[] | null = null;
  if (match[4] !== undefined) {
    const ids = match[4].split(".");
    if (ids.length === 0 || !ids.every(isValidPreIdentifier)) return null;
    pre = ids;
  }
  return { major, minor, patch, pre };
};

/** True for the compiled-from-source sentinel (`0.0.0-dev`). */
export const isDevDaemonVersion = (version: unknown): boolean => {
  if (typeof version !== "string") return false;
  return version.trim() === DEV_DAEMON_VERSION;
};

/**
 * SemVer §11 precedence for daemon binary floors: `-1` / `0` / `1`, or null
 * when either side is unparseable. A release outranks any prerelease of the
 * same base; numeric prerelease identifiers compare by digit length then
 * lexicographically (arbitrary magnitude — never `Number`).
 */
export const compareDaemonSemver = (
  left: string,
  right: string,
): -1 | 0 | 1 | null => {
  const leftParts = parseDaemonSemver(left);
  const rightParts = parseDaemonSemver(right);
  if (leftParts === null || rightParts === null) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    const order = compareDigitIds(leftParts[key], rightParts[key]);
    if (order !== 0) return order;
  }
  if (leftParts.pre === null && rightParts.pre === null) return 0;
  if (leftParts.pre === null) return 1;
  if (rightParts.pre === null) return -1;
  const leftIds = leftParts.pre;
  const rightIds = rightParts.pre;
  const shared = Math.min(leftIds.length, rightIds.length);
  for (let i = 0; i < shared; i += 1) {
    const a = leftIds[i] ?? "";
    const b = rightIds[i] ?? "";
    if (a === b) continue;
    const aNumeric = CANONICAL_NUMERIC_ID.test(a);
    const bNumeric = CANONICAL_NUMERIC_ID.test(b);
    if (aNumeric && bNumeric) return compareDigitIds(a, b);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  if (leftIds.length === rightIds.length) return 0;
  return leftIds.length < rightIds.length ? -1 : 1;
};

/** True when both parse and `current` is greater than or equal to `minimum`. */
export const isDaemonVersionAtLeast = (
  current: string,
  minimum: string,
): boolean => {
  const order = compareDaemonSemver(current, minimum);
  return order !== null && order >= 0;
};
