import { Schema as S } from "effect";
import { AuthEvent } from "./auth";
import { RelayCommandLifecycleFrame } from "./control-channel";
import { DaemonCommand, DaemonCommandAck } from "./daemon";
import { ReplaySessionId } from "./replay-session";
import { TEAM_GRANT_B64_MAX } from "./team-grant";

// ─── Daemon relay (push over a Sandbox WebSocket, in-memory routing) ──
//
// A persistent WebSocket each end (daemon AND browser) holds to a relay
// running in a Vercel Sandbox. The relay routes commands IN MEMORY: a
// watcher's `enqueue` is forwarded straight to the matching daemon socket
// and the daemon's terminal `ack` rides back as a live `command_lifecycle`
// frame — there is no `daemon_commands` mailbox and no Neon CDC. The one
// durable write the relay keeps is `api_key_activity` presence/status, read
// by the stateless `/v1/*` proxy + a cold dashboard load. See
// `docs/proposals/daemon-owned-state-stateless-relay.md`.

/** Which end a connect ticket authorizes. A `daemon` socket receives
 *  commands for its `key_id` and sends acks/status; a `watcher` socket
 *  (a dashboard tab) enqueues commands for keys its `user_id` owns and
 *  receives status/presence pushes. */
/** `origin` is the cloud `/v1/*` proxy dialing in as a FLEET consumer
 *  (origin-side tunneling): it may only open mux channels, and the relay
 *  stamps its channels `consumer:"daemon"` exactly like a peer daemon's. */
export const RelayRole = S.Literals(["daemon", "watcher", "origin"]);
export type TRelayRole = S.Schema.Type<typeof RelayRole>;

/** Bounded, open-vocabulary capability advertisement limits. */
export const RELAY_CAP_MAX_ITEMS = 32;
export const RELAY_CAP_MAX_LENGTH = 64;
const RelayCapability = S.String.check(
  S.isMinLength(1),
  S.isMaxLength(RELAY_CAP_MAX_LENGTH),
);
const RelayCapabilities = S.Array(RelayCapability).check(
  S.isMaxLength(RELAY_CAP_MAX_ITEMS),
);

/**
 * Channel ids are the mux envelope's canonical UUID in text form —
 * RFC 4122 lowercase hex with variant nibble `8|9|a|b` (matches
 * `@openllmsh/sdk/tunnel` `isChannelId` / `CHANNEL_ID_PATTERN`).
 */
const CHANNEL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ChannelId = S.String.check(S.isPattern(CHANNEL_ID_PATTERN));
export type TChannelId = S.Schema.Type<typeof ChannelId>;

/** Bounded open-vocabulary peer errors and refusal reasons. */
const RelayFreeString = S.String.check(S.isMinLength(1), S.isMaxLength(200));

/** The port the in-sandbox WS server listens on — declared in `ports` at
 *  `Sandbox.getOrCreate` (cloud) and bound by the relay. A fixed internal
 *  constant (the public surface is the sandbox's own domain), shared so the
 *  provisioner's `sandbox.domain(port)` and the relay's listener agree. */
export const RELAY_PORT = 8080;

export type TRelayDatabaseTarget = "pre-production" | "production";

/**
 * The relay identity (sandbox name + TTL class) for the current deployment,
 * derived from `VERCEL_ENV` — the only remaining discriminator now that a
 * single `DATABASE_URL_UNPOOLED` selects the Neon database per environment
 * (Vercel injects the matching value in each env; local dev points it at the
 * dev branch). `production` only on the Vercel production deployment;
 * everything else (preview, `vercel dev`, plain `next dev`, tests) is
 * `pre-production`. Pure (a function of its input) so the DB client, the cloud
 * provisioner, and the in-sandbox relay all agree from the same signal.
 */
export const resolveDatabaseTarget = (
  vercelEnv: string | undefined,
): TRelayDatabaseTarget =>
  vercelEnv === "production" ? "production" : "pre-production";

/** The name of the retired daemon-relay logical-replication slot. The relay no
 *  longer subscribes it (commands route in memory) — this is kept ONLY so
 *  `packages/db/migrate.ts` can DROP a leftover slot on deploy (Phase 5
 *  demolition). The matching `daemon_relay_pub` publication is dropped by
 *  `migrations/0007_chunky_expediter.sql` using its literal name. */
export const RELAY_SLOT = "daemon_relay_slot";

/** The per-environment relay identity — just the sandbox name now (the
 *  publication/slot the CDC era carried are gone). Pure derivation (no env, no
 *  I/O) so the cloud provisioner and the relay agree. */
export type TRelayNames = {
  readonly relayName: string;
};

export const relayNamesFor = (target: TRelayDatabaseTarget): TRelayNames => ({
  relayName: `daemon-relay-${target}`,
});

// ─── Sandbox origin tags (deprovisioning) ─────────────────────────────
//
// The provisioner tags each relay sandbox with the stable ORIGIN that uses it
// — the deployment "place" (production URL / preview branch URL / local
// hostname) — plus a freshness timestamp, refreshed on healthy channel
// fetches. The cleanup cron groups boxes by origin and gracefully stops a
// superseded box (same origin, older freshness, different bundle hash) —
// see `lib/relay-sandbox-cleanup.ts`.

/** Tag key: the sanitized stable origin that provisioned/uses this box. */
export const RELAY_TAG_ORIGIN = "origin";
/** Tag key: unix-ms (decimal string) of the origin's last claim/refresh. */
export const RELAY_TAG_ORIGIN_AT = "origin-at";

/** The env signals the origin is derived from. `localHostname` is caller-
 *  provided (`os.hostname()`) so this stays pure and testable. */
export type TRelayOriginInputs = {
  readonly vercelEnv: string | undefined;
  readonly projectProductionUrl: string | undefined;
  readonly branchUrl: string | undefined;
  readonly deploymentUrl: string | undefined;
  readonly localHostname: string | undefined;
};

/** Sandbox tag values must be short, plain tokens. Lowercase, strip the
 *  protocol + trailing slash, squash anything outside [a-z0-9._-], cap at 64.
 *  Returns null when nothing usable remains so the caller can fall back. */
const sanitizeOriginTag = (raw: string | undefined): string | null => {
  if (raw === undefined) return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/[^a-z0-9._-]/g, "-")
    .slice(0, 64);
  return cleaned === "" ? null : cleaned;
};

/**
 * The STABLE origin identity for sandbox tagging — stable across deploys of
 * the same "place", so the cleanup cron's per-origin change detection fires:
 *   production → the project production URL (not the per-deploy VERCEL_URL);
 *   preview    → the branch URL (stable per git branch), falling back to the
 *                per-deploy URL only when the branch URL is absent;
 *   local/test → `local-<hostname>` so two developers never supersede each
 *                other's boxes.
 * Pure (a function of its inputs) per the convention above.
 */
export const resolveRelayOrigin = (inputs: TRelayOriginInputs): string => {
  if (inputs.vercelEnv === "production") {
    return sanitizeOriginTag(inputs.projectProductionUrl) ?? "production";
  }
  if (inputs.vercelEnv === "preview") {
    return (
      sanitizeOriginTag(inputs.branchUrl) ??
      sanitizeOriginTag(inputs.deploymentUrl) ??
      "preview"
    );
  }
  const host = sanitizeOriginTag(inputs.localHostname);
  return host === null ? "local" : `local-${host}`;
};

/**
 * The decoded claims of a connect ticket. The cloud (`/api/daemon/channel`)
 * mints these after validating the caller (`sk-llm` key → `daemon`, Neon
 * Auth session → `watcher`) and Ed25519-signs them; the relay verifies with
 * the corresponding public key only (it does NO DB-side auth in the
 * Sandbox and cannot mint tickets). `key_id` is present iff
 * `role === "daemon"`. `exp` is a unix-ms deadline kept short (~60s) so a
 * leaked ticket is near-useless. `aud` binds the ticket to a specific relay
 * sandbox name; `jti` is a one-shot nonce consumed by the relay.
 */
export const RelayTicketClaims = S.Struct({
  role: RelayRole,
  user_id: S.String,
  key_id: S.optional(S.String),
  exp: S.Number,
  /** Relay sandbox audience, e.g. `daemon-relay-production`. */
  aud: S.String.check(S.isMinLength(1), S.isMaxLength(128)),
  /** Unique ticket id (base64url) — single-use within the TTL window. */
  jti: S.String.check(S.isMinLength(16), S.isMaxLength(64)),
});
export type TRelayTicketClaims = S.Schema.Type<typeof RelayTicketClaims>;

/**
 * Domain-separation label for the Ed25519 seed derivation. Shared by the
 * cloud signer and the verifier so both derive the same keypair from
 * `NEON_AUTH_COOKIE_SECRET`. The sandbox receives only the public half.
 */
export const RELAY_TICKET_SEED_LABEL = "openllm-relay-ticket-ed25519-seed-v1";

/** One ICE server entry (STUN or TURN) on the channel handshake — mirrors
 *  `RTCIceServer` so browser and daemon feed it to their peer connections
 *  verbatim. */
export const IceServer = S.Struct({
  urls: S.Union([S.String, S.Array(S.String)]),
  username: S.optional(S.String),
  credential: S.optional(S.String),
});
export type TIceServer = S.Schema.Type<typeof IceServer>;

/** GET /api/daemon/channel → the live relay WSS URL + a connect ticket. Both
 *  daemon and browser dial `wss_url`, presenting `ticket` in their first
 *  `hello` frame. The URL is the sandbox's own domain (`wss://<sandbox-host>`);
 *  it can rotate when the relay cycles, so clients re-fetch this on every
 *  (re)connect rather than caching the host. `ice_servers` is the optional
 *  cloud-served ICE config (from `OPENLLM_RTC_ICE_SERVERS`) — absent, both
 *  ends fall back to their default STUN. */
export const RelayChannelResponse = S.Struct({
  wss_url: S.String,
  /** Short-lived Ed25519-signed connect ticket
   *  (opaque `<b64url(claims)>.<b64url(sig)>`). */
  ticket: S.String,
  /** Optional cloud-served ICE servers (STUN/TURN) for RTC peers. */
  ice_servers: S.optional(S.Array(IceServer)),
});
export type TRelayChannelResponse = S.Schema.Type<typeof RelayChannelResponse>;

// ─── WebSocket frame envelope ────────────────────────────────────────
//
// One tagged union shared by all four parties. Each variant documents its
// direction; a given end only emits the subset it owns and ignores the
// rest. JSON over text frames.

/** client → relay (first frame). A daemon may piggyback its initial
 *  status snapshot; a watcher sends ticket only. */
export const RelayHelloFrame = S.Struct({
  type: S.Literal("hello"),
  ticket: S.String,
  /** Daemon protocol capability; absent daemons retain legacy compatibility. */
  protocol_version: S.optional(S.Number),
  /** Open-vocabulary peer capability list.
   * Unknown capabilities preserve forward compatibility. */
  caps: S.optional(RelayCapabilities),
  /** Daemon only: initial per-provider `TDaemonStatus` snapshot, folded
   *  into `api_key_activity.daemon_status_json` on connect. */
  status: S.optional(S.Unknown),
});
export type TRelayHelloFrame = S.Schema.Type<typeof RelayHelloFrame>;

/** relay → client. Handshake accepted; carries the current presence snapshot so
 *  a freshly-attached dashboard paints immediately. */
export const RelayWelcomeFrame = S.Struct({
  type: S.Literal("welcome"),
  /** Watcher only: the AUTHORITATIVE set of the user's key ids that have a live
   *  daemon socket on the relay right now, from its in-memory registry. The
   *  dashboard treats membership as presence — keys absent here are offline by
   *  authority of the relay that owns every socket — so a stale-`true`
   *  `api_key_activity` row (ungraceful relay death) is corrected the instant a
   *  watcher (re)connects. Live status keeps flowing via `status_push`. */
  snapshot: S.optional(S.Array(S.String)),
  /** Daemon only: relay-assigned connection epoch for ordered snapshots. */
  daemon_session_id: S.optional(S.String),
  daemon_session_started_at_ms: S.optional(S.Number),
  protocol_version: S.optional(S.Number),
  /** Relay capabilities. */
  caps: S.optional(RelayCapabilities),
  /** Per-serving-daemon capability snapshots, parallel to `snapshot`. */
  snapshot_caps: S.optional(S.Record(S.String, RelayCapabilities)),
});
export type TRelayWelcomeFrame = S.Schema.Type<typeof RelayWelcomeFrame>;

/** relay → daemon. One command to run, routed in memory the instant the watcher
 *  enqueues it (no durable mailbox). `id` is a relay-generated uuid. */
export const RelayCommandFrame = S.Struct({
  type: S.Literal("command"),
  command: DaemonCommand,
});
export type TRelayCommandFrame = S.Schema.Type<typeof RelayCommandFrame>;

/** daemon → relay. A terminal command result; the relay forwards it to the
 *  originating watcher as a `command_lifecycle` frame (no `daemon_commands`
 *  row to update). */
export const RelayAckFrame = S.Struct({
  type: S.Literal("ack"),
  ack: DaemonCommandAck,
});
export type TRelayAckFrame = S.Schema.Type<typeof RelayAckFrame>;

/** Planned-downtime reason on a graceful `active:false` status beacon.
 *  Absent ⇒ real offline / legacy beacon (CERTAIN death). */
export const RelayStatusRestartReason = S.Literal("restarting");
export type TRelayStatusRestartReason = S.Schema.Type<
  typeof RelayStatusRestartReason
>;

/** daemon → relay. Heartbeat + per-provider snapshot. `active:false` is the
 *  graceful-exit beacon. The relay folds the snapshot into
 *  `api_key_activity.daemon_status_json` (durable, read by the proxy + a cold
 *  HTTP load) and fans it out to the user's watchers (`status_push`).
 *
 *  Planned restarts send `active:false` WITH `reason:"restarting"` (and an
 *  optional `expect_back_ms` hint) so the relay keeps the row routable —
 *  `daemon_active` stays true and `last_seen` stays fresh — while origin's
 *  presence grace absorbs the brief gap. A bare `active:false` remains a
 *  CERTAIN death (`daemon_active=false`). See
 *  `docs/audit/2026-10-20-deploy-zero-downtime.md` fix #2. */
export const RelayStatusFrame = S.Struct({
  type: S.Literal("status"),
  active: S.optional(S.Boolean),
  status: S.optional(S.Unknown),
  /** Present for protocol-v2 daemon status snapshots. */
  daemon_session_id: S.optional(S.String),
  status_seq: S.optional(S.Number),
  acks: S.optional(S.Array(DaemonCommandAck)),
  /** Planned downtime; absent ⇒ real offline / legacy beacon. */
  reason: S.optional(RelayStatusRestartReason),
  /** Hint for origin grace / UI: ms until this key should be back. */
  expect_back_ms: S.optional(S.Number),
});
export type TRelayStatusFrame = S.Schema.Type<typeof RelayStatusFrame>;

/** watcher → relay. The dashboard enqueues a control command for one of the
 *  user's keys. The relay authorizes it by REGISTRY MEMBERSHIP — a watcher may
 *  address `key_id` K iff a daemon socket for K is connected with the same
 *  `user_id` (off that daemon's ticket) — then routes it to that socket in
 *  memory. `req_id` correlates the relay's `enqueue_ack`; omit it for
 *  fire-and-forget. */
export const RelayEnqueueFrame = S.Struct({
  type: S.Literal("enqueue"),
  req_id: S.optional(S.String),
  key_id: S.String,
  kind: S.String,
  payload: S.optional(S.Unknown),
  replay_session_id: S.optional(ReplaySessionId),
});
export type TRelayEnqueueFrame = S.Schema.Type<typeof RelayEnqueueFrame>;

/** relay → watcher. The result of an `enqueue` carrying a `req_id`: the
 *  relay-generated command id on success, or an error (`daemon_offline` /
 *  `invalid_command`). */
export const RelayEnqueueAckFrame = S.Struct({
  type: S.Literal("enqueue_ack"),
  req_id: S.String,
  ok: S.Boolean,
  id: S.optional(S.String),
  error: S.optional(S.String),
});
export type TRelayEnqueueAckFrame = S.Schema.Type<typeof RelayEnqueueAckFrame>;

/** relay → watcher. A daemon's status snapshot for one key landed; push it
 *  to the dashboard. */
export const RelayStatusPushFrame = S.Struct({
  type: S.Literal("status_push"),
  key_id: S.String,
  status: S.Unknown,
  daemon_session_id: S.optional(S.String),
  daemon_session_started_at_ms: S.optional(S.Number),
  status_seq: S.optional(S.Number),
});
export type TRelayStatusPushFrame = S.Schema.Type<typeof RelayStatusPushFrame>;

/** relay → watcher. A key's daemon presence flipped (socket open/close). */
export const RelayPresenceFrame = S.Struct({
  type: S.Literal("presence"),
  key_id: S.String,
  active: S.Boolean,
  /** Present when an active daemon advertises capabilities. */
  caps: S.optional(RelayCapabilities),
});
export type TRelayPresenceFrame = S.Schema.Type<typeof RelayPresenceFrame>;

// ─── Subscription tunnel + device sessions (mux-only) ────────────────
//
// A consumer (browser watcher socket, or another daemon's socket) opens a
// mux stream through the relay to a SERVING daemon (over the relay binary
// mux or a direct RTC data channel), which dispatches the request against
// its own local `/v1/*` data plane and streams the response back. Device
// PTY sessions ride the same mux. Same-user only (registry-membership auth,
// exactly like `enqueue`); the vendor subscription token never crosses —
// only OpenLLM-wire bytes do. The relay never decodes mux payloads. The
// legacy JSON `tunnel_*` / `session_*` splice frames have been removed.
// See `docs/features/sub-tunnel-and-chat-sessions.md`.

/**
 * Max base64 length of a seed-gated device-grant envelope on open frames.
 * Real envelopes are a few hundred bytes (JSON of nonce/ts/key_id/cid/aud +
 * Ed25519 sig, then base64); 4 KiB is generous headroom so a peer cannot
 * push an unbounded string through Schema re-encode into the daemon.
 *
 * Canonical owner for the wire cap. `@openllmsh/sdk/tunnel/device-grant` re-exports
 * the same value so decode stays aligned with Schema maxLength.
 */
export const DEVICE_GRANT_B64_MAX = 4 * 1024;

/**
 * Internal hop marker: the serving daemon stamps this on every request it
 * dispatches from a tunnel open so a fleet-peer walker can refuse to
 * re-tunnel (loop guard). Not a client-facing API.
 */
export const TUNNELED_REQUEST_HEADER = "x-openllm-tunneled";

/** Response header naming the device key that served a tunneled request. */
export const SERVED_BY_DEVICE_HEADER = "x-openllm-served-by-device";

/**
 * Request header pinning a follow-up to the device that served an earlier
 * call (a video job lives on ONE device's vendor account; its id does not
 * name the device). Any client may echo back {@link SERVED_BY_DEVICE_HEADER}
 * here. Honoured only if that key is one of the caller's own serving
 * devices — it reorders the candidates, never widens them.
 */
export const TARGET_DEVICE_HEADER = "x-openllm-target-device";
export const TUNNELED_REQUEST_VALUE = "1";

// ─── Mux channels (consumer ⇄ relay ⇄ serving daemon) ─────────────────

/** consumer → relay → serving daemon. Auth runs once when opening this
 * channel; after acceptance, all subsequent binary frames on both sockets
 * belong to this channel. */
export const RelayChannelOpenFrame = S.Struct({
  type: S.Literal("channel_open"),
  channel_id: ChannelId,
  key_id: S.String,
  /**
   * Who is opening the channel. The relay stamps this from the authenticated
   * socket role before forward (`watcher` → `browser`, `daemon` → `daemon`) —
   * clients may set it but the relay overwrites. `daemon` marks a fleet peer
   * hop so the serving daemon skips seedgate (no vault DEK on the consumer).
   * Omitted / `browser` is the default seed-gated path.
   */
  consumer: S.optional(S.Literals(["browser", "daemon"])),
  /**
   * Seed-gated device grant (base64 envelope). Present when the serving
   * daemon advertises `seedgate1`. Relay re-encodes via Schema — must be
   * on the schema so it survives forward; never verified by the relay.
   * Bounded so a peer cannot ship an arbitrarily large grant past re-encode.
   */
  grant: S.optional(S.String.check(S.isMaxLength(DEVICE_GRANT_B64_MAX))),
  /**
   * Origin-signed team grant (base64 envelope). Required for cross-user
   * admission: the relay admits when non-empty (it does NOT verify — the
   * contributor daemon re-checks with its bootstrap `team_grant_key`).
   * Same-user opens omit it. Opaque to the payload path; bounded like
   * {@link DEVICE_GRANT_B64_MAX}.
   */
  team_grant: S.optional(S.String.check(S.isMaxLength(TEAM_GRANT_B64_MAX))),
  /** Authenticated consumer user id. The relay replaces client input. */
  peer_user_id: S.optional(S.String),
});
export type TRelayChannelOpenFrame = S.Schema.Type<
  typeof RelayChannelOpenFrame
>;

/** Relay-to-daemon form of {@link RelayChannelOpenFrame}. The relay stamps
 * `peer_user_id`; daemons never accept an unstamped open as same-user. */
export const RelayStampedChannelOpenFrame = S.Struct({
  type: S.Literal("channel_open"),
  channel_id: ChannelId,
  key_id: S.String,
  consumer: S.optional(S.Literals(["browser", "daemon"])),
  grant: S.optional(S.String.check(S.isMaxLength(DEVICE_GRANT_B64_MAX))),
  team_grant: S.optional(S.String.check(S.isMaxLength(TEAM_GRANT_B64_MAX))),
  peer_user_id: S.String,
});
export type TRelayStampedChannelOpenFrame = S.Schema.Type<
  typeof RelayStampedChannelOpenFrame
>;

/** serving daemon → relay → consumer. The relay mints failure acknowledgements;
 * an accepting daemon's acknowledgement is echoed verbatim. */
export const RelayChannelOpenAckFrame = S.Struct({
  type: S.Literal("channel_open_ack"),
  channel_id: ChannelId,
  ok: S.Boolean,
  /**
   * Free-string on the wire so newer daemon failures remain decodable by
   * older relay peers. Known values live in {@link ChannelOpenError}.
   */
  error: S.optional(RelayFreeString),
});
export type TRelayChannelOpenAckFrame = S.Schema.Type<
  typeof RelayChannelOpenAckFrame
>;

/** Either side / relay-minted. `relay_restart` is a drain signal: consumers
 * reset in-flight streams and re-open the channel on the successor relay. */
export const RelayChannelCloseFrame = S.Struct({
  type: S.Literal("channel_close"),
  channel_id: ChannelId,
  /** Free-string on the wire; known values live in ChannelCloseReason. */
  reason: S.optional(RelayFreeString),
});
export type TRelayChannelCloseFrame = S.Schema.Type<
  typeof RelayChannelCloseFrame
>;

// ─── WebRTC signaling (consumer ⇄ relay ⇄ serving daemon) ──────────────
//
// SDP + trickle ICE for a direct browser⇄daemon RTCDataChannel. The relay is
// signaling-only: same-user registry-membership auth on `rtc_offer`, then
// verbatim forward of offer/answer/ice between the paired endpoints. Payload
// bytes never touch the relay once the data channel is up. `fingerprint_proof`
// is sealed-box ciphertext from `@openllmsh/sdk/tunnel` rtc-auth (DTLS fingerprint
// bound to the daemon-minted grant) — the relay never inspects it.
//
// `candidate` is a JSON string of an `RTCIceCandidateInit` (or the werift
// equivalent) so browser and daemon peers share one serialization without
// inventing a side-car candidate schema.

/**
 * Soft upper bound for an SDP blob on the signaling plane. Real offers/
 * answers are a few KB; 64 KiB leaves headroom while staying well under a
 * typical WebSocket frame budget (~1 MiB on Cloudflare / PartySocket).
 */
export const RTC_SDP_MAX = 64 * 1024;

/**
 * Soft upper bound for a base64 sealed fingerprint proof. Sealed-box
 * ciphertext for the offer/answer inner is well under 2 KiB even with a
 * nested device grant; 8 KiB is a conservative ceiling.
 */
export const RTC_FINGERPRINT_PROOF_B64_MAX = 8 * 1024;

/**
 * Soft upper bound for a JSON-serialized `RTCIceCandidateInit`. A single
 * candidate line + mid/mline fields is typically < 512 B; 4 KiB is generous.
 */
export const RTC_ICE_CANDIDATE_MAX = 4 * 1024;

/** consumer → relay → serving daemon. Open an RTC signaling session aimed at
 *  the daemon serving `key_id`. The consumer mints `channel_id` (uuid); the
 *  relay authorizes by registry membership and registers the pair so later
 *  `rtc_answer` / `rtc_ice` frames route by `channel_id`. */
export const RelayRtcOfferFrame = S.Struct({
  type: S.Literal("rtc_offer"),
  channel_id: ChannelId,
  key_id: S.String,
  sdp: S.String.check(S.isMaxLength(RTC_SDP_MAX)),
  fingerprint_proof: S.String.check(
    S.isMaxLength(RTC_FINGERPRINT_PROOF_B64_MAX),
  ),
  /** Opaque origin-signed grant required for cross-user RTC admission. */
  team_grant: S.optional(S.String.check(S.isMaxLength(TEAM_GRANT_B64_MAX))),
  /** Authenticated consumer id. The relay replaces client input. */
  peer_user_id: S.optional(S.String),
  /** Authenticated consumer kind. The relay replaces client input. */
  consumer: S.optional(S.Literals(["browser", "daemon"])),
});
export type TRelayRtcOfferFrame = S.Schema.Type<typeof RelayRtcOfferFrame>;

/** Relay-to-daemon form of {@link RelayRtcOfferFrame}. The relay stamps both
 * identity fields; an unstamped offer is rejected as an outdated relay. */
export const RelayStampedRtcOfferFrame = S.Struct({
  type: S.Literal("rtc_offer"),
  channel_id: ChannelId,
  key_id: S.String,
  sdp: S.String.check(S.isMaxLength(RTC_SDP_MAX)),
  fingerprint_proof: S.String.check(
    S.isMaxLength(RTC_FINGERPRINT_PROOF_B64_MAX),
  ),
  team_grant: S.optional(S.String.check(S.isMaxLength(TEAM_GRANT_B64_MAX))),
  peer_user_id: S.String,
  consumer: S.Literals(["browser", "daemon"]),
});
export type TRelayStampedRtcOfferFrame = S.Schema.Type<
  typeof RelayStampedRtcOfferFrame
>;

/** serving daemon → relay → consumer. Answer the offer for `channel_id`. */
export const RelayRtcAnswerFrame = S.Struct({
  type: S.Literal("rtc_answer"),
  channel_id: ChannelId,
  sdp: S.String.check(S.isMaxLength(RTC_SDP_MAX)),
  fingerprint_proof: S.String.check(
    S.isMaxLength(RTC_FINGERPRINT_PROOF_B64_MAX),
  ),
});
export type TRelayRtcAnswerFrame = S.Schema.Type<typeof RelayRtcAnswerFrame>;

/** Both directions. One trickle ICE candidate for `channel_id`. `candidate` is
 *  a JSON-serialized `RTCIceCandidateInit` object (stringified by the sender,
 *  `JSON.parse`'d by the receiver) — preferred over a raw SDP candidate line
 *  for browser/werift field parity (`candidate`/`sdpMid`/`sdpMLineIndex`/…). */
export const RelayRtcIceFrame = S.Struct({
  type: S.Literal("rtc_ice"),
  channel_id: ChannelId,
  candidate: S.String.check(S.isMaxLength(RTC_ICE_CANDIDATE_MAX)),
});
export type TRelayRtcIceFrame = S.Schema.Type<typeof RelayRtcIceFrame>;

/** Why a serving daemon refused an `rtc_offer`. `seedgate` = the vault DEK is
 * locked (retry after unlock); `overloaded` = transient session cap (retry
 * soon); `disabled` / `not_capable` / `handshake_failed` = daemon posture or
 * a failed pre-mux handshake (cache the failure — it will not recover on this
 * immediate retry). `proof_open_failed` means the offer was sealed to a stale
 * daemon X25519 key; consumers should refresh the cloud identity projection.
 * `daemon_outdated` means a relay or daemon omitted a required current stamp. */
export const RtcNackReason = S.Literals([
  "seedgate",
  "overloaded",
  "disabled",
  "not_capable",
  "handshake_failed",
  "proof_open_failed",
  "daemon_outdated",
]);
export type TRtcNackReason = S.Schema.Type<typeof RtcNackReason>;

/** Normalize a forward-compatible peer refusal to a generic retryable refusal. */
export const normalizeRtcNackReason = (reason: string): TRtcNackReason => {
  switch (reason) {
    case "seedgate":
    case "overloaded":
    case "disabled":
    case "not_capable":
    case "handshake_failed":
    case "proof_open_failed":
    case "daemon_outdated":
      return reason;
    default:
      return "overloaded";
  }
};

/** serving daemon or relay → consumer. Refuse the offer for `channel_id` —
 *  the explicit non-silent reject so the offerer fails fast instead of
 *  waiting out the signaling/ICE timeout. */
export const RelayRtcNackFrame = S.Struct({
  type: S.Literal("rtc_nack"),
  channel_id: ChannelId,
  /**
   * Free-string on the wire so a newer daemon refusal stays decodable. Known
   * values live in {@link RtcNackReason}; unrecognized values are generic,
   * non-cacheable refusals to consumers.
   */
  reason: RelayFreeString,
});
export type TRelayRtcNackFrame = S.Schema.Type<typeof RelayRtcNackFrame>;

/** relay → every client. This box is superseded (a newer relay deploy is
 *  accepting): move to the box `/api/daemon/channel` now returns. The box
 *  admits no new work, finishes in-flight channels, then closes each socket
 *  with {@link RELAY_MOVED_CLOSE_CODE}. Old clients drop the unknown frame and
 *  move on that close. See `docs/plans/relay-handover.md`. */
export const RelayMovedFrame = S.Struct({ type: S.Literal("relay_moved") });
export type TRelayMovedFrame = S.Schema.Type<typeof RelayMovedFrame>;

/** Close code of a retired box's socket: reconnect immediately (no backoff).
 *  Distinct from 4000 `superseded`, so it never triggers daemon stand-down. */
export const RELAY_MOVED_CLOSE_CODE = 4010;

/** Keepalive (both directions). The relay pings below Cloudflare's
 *  proxied-WS idle bound; a missed pong is the relay's dead-peer signal. */
export const RelayPingFrame = S.Struct({ type: S.Literal("ping") });
export type TRelayPingFrame = S.Schema.Type<typeof RelayPingFrame>;

export const RelayPongFrame = S.Struct({ type: S.Literal("pong") });
export type TRelayPongFrame = S.Schema.Type<typeof RelayPongFrame>;

/**
 * daemon → relay → watcher. Explicit subscription-auth FSM (`auth.ts`).
 *
 * Same `type: "auth"` from both roles so `parseFrame` accepts it the way
 * `status` is accepted from the daemon (there is no separate DaemonToRelay
 * union). Frame-level `key_id` is the routing key; the inner event also
 * carries `key_id` (and `flow_id` except on `auth.session.lost`).
 *
 * Old relays that predate this member fail-decode the frame and drop it
 * (`parseFrame` → null) — the designed unknown-type tolerance. New relays
 * parse it even before they route it.
 */
export const RelayAuthFrame = S.Struct({
  type: S.Literal("auth"),
  key_id: S.String,
  auth: AuthEvent,
});
export type TRelayAuthFrame = S.Schema.Type<typeof RelayAuthFrame>;

// NOTE: older daemon binaries also sent `received` (a per-command delivery
// receipt) and `resync` (a periodic "re-push my pending rows" floor). Both are
// retired — there is no durable mailbox to redeliver from anymore — so neither
// has a consumer. They are deliberately NOT in the union; an old daemon's frames
// fail decode and are silently dropped (`parseFrame` → null), the designed
// legacy tolerance. The same silent-drop applies to any unknown `type` (e.g. a
// future `rtc_*` peer talking to an older relay, or vice versa).

/** The full frame union, discriminated on `type`. `command_lifecycle` (relay →
 *  watcher) is the stateless-relay command receipt: the relay forwards the
 *  daemon's terminal `ack` to the originating watcher as a live lifecycle
 *  update, so the dashboard releases an optimistic button off the socket — no
 *  DB `command_seq` cursor. See `control-channel.ts` +
 *  `docs/proposals/daemon-owned-state-stateless-relay.md`. `auth` (daemon →
 *  relay → watcher) is the subscription-login FSM; it is not a CommandState. */
export const RelayFrame = S.Union([
  RelayHelloFrame,
  RelayWelcomeFrame,
  RelayCommandFrame,
  RelayAckFrame,
  RelayStatusFrame,
  RelayEnqueueFrame,
  RelayEnqueueAckFrame,
  RelayStatusPushFrame,
  RelayPresenceFrame,
  RelayCommandLifecycleFrame,
  RelayAuthFrame,
  RelayChannelOpenFrame,
  RelayChannelOpenAckFrame,
  RelayChannelCloseFrame,
  RelayRtcOfferFrame,
  RelayRtcAnswerFrame,
  RelayRtcIceFrame,
  RelayRtcNackFrame,
  RelayMovedFrame,
  RelayPingFrame,
  RelayPongFrame,
]);
export type TRelayFrame = S.Schema.Type<typeof RelayFrame>;
