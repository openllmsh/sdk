import {
  isDaemonVersionAtLeast,
  isDevDaemonVersion,
  parseDaemonSemver,
} from "./semver";
import type { TSubscriptionDaemonFloor } from "./subscription-daemon-floors";
import { SUBSCRIPTION_DAEMON_FLOORS } from "./subscription-daemon-floors";
import type { TSubscriptionProviderSlug } from "./subscription-provider";
import { isSubscriptionProviderSlug } from "./subscription-provider";

/**
 * Provider-level minimum daemon version for subscription control-plane UI.
 *
 * Floors live in `subscription-daemon-floors.ts`. `unreleased` falls back to
 * live `connections[]` membership; the release publisher stamps unreleased
 * entries to `{ state: "since", version }` before the protocol mirror and
 * commits them with `DAEMON_RELEASE`.
 */

export const subscriptionDaemonFloorOf = (
  slug: string,
): TSubscriptionDaemonFloor | undefined => {
  if (!isSubscriptionProviderSlug(slug)) return undefined;
  const keyed: TSubscriptionProviderSlug = slug;
  return SUBSCRIPTION_DAEMON_FLOORS[keyed];
};

/**
 * Live capability probe from a daemon status snapshot.
 *
 * - Cached / not-yet-live status → unknown (`null`).
 * - Live complete snapshot that omits the slug → unsupported (`false`).
 * - Live snapshot that includes the slug → supported (`true`).
 * - Empty connections → unknown (`null`).
 */
export const liveSubscriptionProviderSupport = (
  connections: ReadonlyArray<{ readonly provider: string }>,
  slug: string,
  options?: { readonly liveConfirmed?: boolean },
): boolean | null => {
  if (options?.liveConfirmed !== true) return null;
  if (connections.length === 0) return null;
  return connections.some((c) => c.provider === slug);
};

export type TSubscriptionProviderSupportOptions = {
  readonly daemonVersion?: string | null;
  readonly connections: ReadonlyArray<{ readonly provider: string }>;
  readonly liveConfirmed?: boolean;
};

/**
 * Pure floor + live resolver. Tests pass an explicit floor; production uses
 * {@link subscriptionProviderSupportedOnDaemon}.
 */
export const subscriptionProviderSupportWithFloor = (
  slug: string,
  floor: TSubscriptionDaemonFloor | undefined,
  options: TSubscriptionProviderSupportOptions,
): boolean | null => {
  const live = (): boolean | null =>
    liveSubscriptionProviderSupport(options.connections, slug, {
      liveConfirmed: options.liveConfirmed,
    });

  if (floor === undefined || floor.state === "unreleased") return live();

  const version = options.daemonVersion;
  if (
    typeof version !== "string" ||
    version.trim().length === 0 ||
    isDevDaemonVersion(version) ||
    parseDaemonSemver(version) === null
  ) {
    return live();
  }

  if (!isDaemonVersionAtLeast(version, floor.version)) return false;

  // Version meets the floor. A live-confirmed omission still wins so a
  // custom / stripped build is not falsely treated as Muse-capable.
  if (options.liveConfirmed === true && options.connections.length > 0) {
    return live();
  }
  return true;
};

/**
 * Resolve whether a subscription provider is usable on the selected daemon.
 *
 * Released floors give a deterministic older-daemon "update required" from
 * static metadata. Dev / unparseable / unreleased builds keep the live
 * connections probe as the hard gate (and as a capability fallback when a
 * new-enough binary still omits the provider).
 */
export const subscriptionProviderSupportedOnDaemon = (
  slug: string,
  options: TSubscriptionProviderSupportOptions,
): boolean | null =>
  subscriptionProviderSupportWithFloor(
    slug,
    subscriptionDaemonFloorOf(slug),
    options,
  );
