import { Schema as S } from "effect";

/** Header carrying an origin-authorized single device hop. */
export const HOP_GRANT_HEADER = "x-openllm-hop-grant";

/** Upper bound on an encoded hop grant on the wire (payload + signature). */
export const HOP_GRANT_B64_MAX = 2048;

/**
 * Daemon capability header. A daemon sends it on every plan fetch; the cloud
 * refuses capped plans and hop-grant redemption without it
 * (`daemon_outdated`), so a daemon that can't report holds never serves a
 * capped key uncapped.
 */
export const DAEMON_CAPS_HEADER = "x-openllm-daemon-caps";
export const DAEMON_CAPS_HOLDS = "holds-v2";

/**
 * Short-lived authorization for one model and its consumer-key hold, for ONE
 * device: only `device_key_id` may redeem it, and only that key may then
 * report the hold's usage.
 */
export const HopGrant = S.Struct({
  v: S.Literal(1),
  user_id: S.String,
  key_id: S.String,
  device_key_id: S.String,
  model: S.String,
  nonce: S.String,
  exp: S.Number,
});

export type THopGrant = S.Schema.Type<typeof HopGrant>;
