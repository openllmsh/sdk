/**
 * The two halves of a boot's unlock, in order: `home` (the home key alone) and
 * `key` (the box's API key, once the box has proven itself). The ONE
 * definition: the seal, the wire request schema and the browser's "what is
 * owed" step all derive from it. Import-free so the schema (and the relay
 * bundle built from it) can read it without the crypto.
 */
export const ROUTEBOX_UNLOCK_PHASES = ["home", "key"] as const;

export type TRouteboxUnlockPhase = (typeof ROUTEBOX_UNLOCK_PHASES)[number];
