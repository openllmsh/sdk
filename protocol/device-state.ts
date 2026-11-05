import { Schema as S } from "effect";
import {
  DaemonCliState,
  DaemonCloudState,
  DaemonProviderConnection,
} from "./daemon";

// ─── Device state — the daemon's live, manifest-derived snapshot ─────
//
// The daemon is the source of truth for what's on the box. This snapshot is
// read LIVE through the relay and never persisted cloud-side: a dashboard with
// no live daemon socket shows offline, which is the truth.
//
// It no longer carries a per-integration `items` array: clients are configured
// at RUN time by `openllm <client>`, so there is nothing installed per client to
// probe. The only install state left is `cli` — which the daemon already knows
// from its auto-update loop, with no probe scripts to run. See
// `docs/proposals/remove-registry-runtime-config-merge.md`.

export type {
  TDaemonCliState,
  TDaemonCloudState,
  TDaemonProviderConnection,
} from "./daemon";
// Re-export the pieces device-state composes so the contract imports from one
// module.
export {
  DaemonCliState,
  DaemonCloudState,
  DaemonProviderConnection,
} from "./daemon";

/**
 * The full device snapshot — daemon self + subscription providers + the openllm
 * CLI's presence. Supersedes `DaemonStatus`: `connections` keeps the
 * per-provider shape.
 */
export const DeviceState = S.Struct({
  daemon_version: S.String,
  /** Whether an sk-llm key is set (the daemon installs keyless). */
  key_configured: S.Boolean,
  /** Auto-update opt-in (default on). Absent on daemons too old to report it. */
  auto_update: S.optional(S.Boolean),
  /** Result of the last cloud bootstrap — drives the 3-state Providers UI. */
  cloud_state: DaemonCloudState,
  /** The OS-sandbox posture this daemon booted with. */
  sandbox: S.optional(S.Literals(["enforced", "off", "unsupported", "error"])),
  /** Loopback port for this daemon's `/v1/*` + `/whoami` surface. */
  port: S.optional(S.Number),
  /** This daemon's X25519 public key (SPKI DER, base64) for cross-machine seal. */
  pubkey: S.optional(S.String),
  /** Subscription-provider connections (claude_code/chatgpt/kimi_code). */
  connections: S.Array(DaemonProviderConnection),
  /** The openllm CLI on this box (from the daemon's auto-update loop). */
  cli: S.optional(DaemonCliState),
});
export type TDeviceState = S.Schema.Type<typeof DeviceState>;

// ─── New relay → watcher frame (stateless-relay transport) ───────────
//
// Supersedes the old `status_push` + `presence` frames: presence is encoded by
// `online`, the snapshot by `device_state` (present iff online). Defined
// additively; the full `RelayFrame` union swap happens with the Phase 3 relay
// rewrite.

/** relay → watcher. A key's daemon presence and/or device-state changed. The
 *  `online`/`device_state` invariant is encoded structurally: `online:true`
 *  ALWAYS carries a `device_state`; `online:false` is the offline flip (the
 *  relay holds no socket for the key) and never carries one. */
export const RelayDeviceStateFrame = S.Union([
  S.Struct({
    type: S.Literal("device_state"),
    key_id: S.String,
    online: S.Literal(true),
    device_state: DeviceState,
  }),
  S.Struct({
    type: S.Literal("device_state"),
    key_id: S.String,
    online: S.Literal(false),
  }),
]);
export type TRelayDeviceStateFrame = S.Schema.Type<
  typeof RelayDeviceStateFrame
>;
