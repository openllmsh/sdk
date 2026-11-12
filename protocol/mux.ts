/**
 * Binary mux payload vocabulary.
 *
 * Binary mux frames are deliberately outside `RelayFrame`: the relay routes on
 * the 9-byte header (defined by `@openllmsh/sdk/tunnel/codec`) and never imports
 * these payload schemas. The 16-byte channel-id envelope (`mux2`) tags each
 * binary message, so one WebSocket can carry several channels concurrently.
 */
import { Schema as S } from "effect";
import * as Result from "effect/Result";
import { AgentStreamOpenPayload } from "./agent";
import { CLIENT_HOST_MAX_LENGTH } from "./client-origin";
import { HOP_GRANT_B64_MAX } from "./hop-grant";
import {
  OPENLLM_CHAIN_HEADER,
  OPENLLM_RESOLVED_MODEL_HEADER,
} from "./inference-headers";
import { RealtimeStreamOpenPayload } from "./realtime";
import { TEAM_GRANT_B64_MAX } from "./team-grant";

/**
 * Capability advertising support for the binary mux wire format: the 16-byte
 * channel-UUID envelope (`@openllmsh/sdk/tunnel` `channel-envelope.ts`) wrapping
 * each binary WebSocket message, so one relay socket can carry several channels
 * (one per (consumer, serving) pair). The wire string stays `"mux2"` — the
 * legacy `"mux1"` single-channel framing has been removed entirely.
 */
export const MUX_CAP = "mux2";

/** Returns whether an open-vocabulary capability list advertises mux support. */
export const hasMuxCap = (caps: readonly string[] | undefined): boolean =>
  caps?.includes(MUX_CAP) ?? false;

/**
 * Capability advertising WebRTC data-channel mux hosting (browser ↔ daemon).
 * Layered on by the daemon when RTC responder support is compiled in.
 */
export const RTC_CAP = "rtc1";

/** Cross-user team RTC admission (outer + sealed team grant required). */
export const TEAM_RTC_CAP = "team-rtc1";

/** Returns whether an open-vocabulary capability list advertises RTC support. */
export const hasRtcCap = (caps: readonly string[] | undefined): boolean =>
  caps?.includes(RTC_CAP) ?? false;

/**
 * Capability advertising seed-gated device-grant enforcement on channel /
 * tunnel / RTC open. Layered on by the daemon when a device-access pubkey is
 * pinned from bootstrap.
 */
export const SEEDGATE_CAP = "seedgate1";

/**
 * Daemon can serve team-shared inference (verifies origin team grants, local
 * cap, kill switch). Advertised on bootstrap caps, mux hello, and
 * `DaemonStatus.control_caps`. Older daemons omit it and are never offered as
 * contributors.
 */
export const TEAM_SERVE_CAP = "team_serve";

/** Returns whether an open-vocabulary capability list advertises seedgate. */
export const hasSeedgateCap = (caps: readonly string[] | undefined): boolean =>
  caps?.includes(SEEDGATE_CAP) ?? false;

/**
 * The serving daemon accepts `client_kind` / `client_host` on a tunnel OPEN's
 * forward headers: the client origin already derived the request came from
 * (a browser on our site or another website loses its `Origin` in the
 * tunnel, so the daemon could not tell on its own). Daemons predating it
 * refuse unknown header keys, so a consumer MUST check this before sending
 * them and otherwise leave them off — the daemon then records what it can
 * see (the forwarded user agent).
 */
export const CLIENT_ORIGIN_CAP = "client1";

export const hasClientOriginCap = (
  caps: Iterable<string> | undefined | null,
): boolean => {
  if (caps === undefined || caps === null) return false;
  for (const cap of caps) if (cap === CLIENT_ORIGIN_CAP) return true;
  return false;
};

/**
 * HTTP media over the existing mux `kind:"tunnel"` stream (STT / TTS / image
 * generations / image edits). Old peers omit this; consumers MUST fail closed
 * before OPEN rather than send unknown surfaces.
 *
 * Advertisement is owned by the daemon hello/status list and MUST stay off
 * until the listener/walker actually serves these surfaces.
 */
export const MEDIA_HTTP_CAP = "media1";

export const hasMediaHttpCap = (caps: readonly string[] | undefined): boolean =>
  caps?.includes(MEDIA_HTTP_CAP) ?? false;

/**
 * POST `/v1/videos` (create job) over mux `kind:"tunnel"`. Distinct from
 * `media1` so a media1-only daemon never receives `video_create` OPEN.
 * Consumers MUST check {@link hasMediaHttpVideoCap} before OPEN.
 * GET poll/content stay off the mux (POST-only).
 */
export const MEDIA_HTTP_VIDEO_CAP = "media2";

export const hasMediaHttpVideoCap = (
  caps: readonly string[] | undefined,
): boolean => caps?.includes(MEDIA_HTTP_VIDEO_CAP) ?? false;

/**
 * The dedicated duplex realtime mux kind (`kind:"realtime"` in
 * {@link StreamOpenPayload}, vocabulary in `./realtime`). A distinct kind
 * from `kind:"tunnel"` (request/response HTTP) and `kind:"agent"` —
 * never overload either for a long-lived bidirectional voice session.
 *
 * NOT YET ADVERTISED: a daemon must add this to its capability list only
 * once (a) a provider delegate actually exposes `credentialForRealtime` and
 * (b) the local runtime path (dial → translate → bound) is wired end to
 * end. An old/unadvertising peer's `kind:"realtime"` OPEN still gets a
 * typed `realtime_unsupported` RESET before any session work starts — "old
 * peer fails before OPEN" is a CONSUMER-side responsibility (check
 * `hasRealtimeDuplexCap` on the peer's caps before calling
 * `@openllmsh/sdk/tunnel/streams`'s `realtimeStream`), not something the wire
 * format itself can enforce.
 */
export const REALTIME_DUPLEX_CAP = "realtime1";

export const hasRealtimeDuplexCap = (
  caps: readonly string[] | undefined,
): boolean => caps?.includes(REALTIME_DUPLEX_CAP) ?? false;

/**
 * Bounded capture for tunneled media HTTP bodies (multipart/binary). Distinct
 * from media-persistence limits. Daemon/cloud request readers should import
 * this rather than duplicating the literal.
 */
export const TUNNEL_MEDIA_MAX_BODY_BYTES = 20 * 1024 * 1024;

/**
 * Normalizes an optional relay version for observability only. Feature gating is
 * capability-based, never version-based.
 */
export const relayProtocolVersionOf = (frame: {
  readonly protocol_version?: number;
}): number => frame.protocol_version ?? 1;

/** The `/v1` surface a tunneled request targets. A closed vocabulary — the
 * serving daemon maps it to its OWN local endpoint path, so no free URL path
 * ever crosses the relay (mirrors the listener's surface discriminator).
 *
 * Validated by the SERVING DAEMON at stream open (mux); the relay never
 * decodes it.
 */
export const TunnelSurface = S.Literals([
  "chat_completions",
  "messages",
  "responses",
  "responses_compact",
  "audio_transcriptions",
  "audio_speech",
  "images_generations",
  "images_edits",
  "video_create",
  "video_retrieve",
  "video_content",
]);
export type TTunnelSurface = S.Schema.Type<typeof TunnelSurface>;

export const MEDIA_HTTP_TUNNEL_SURFACES = [
  "audio_transcriptions",
  "audio_speech",
  "images_generations",
  "images_edits",
  "video_create",
] as const satisfies readonly TTunnelSurface[];

export const isMediaHttpTunnelSurface = (surface: TTunnelSurface): boolean =>
  (MEDIA_HTTP_TUNNEL_SURFACES as readonly string[]).includes(surface);

export const requiredMediaHttpCap = (
  surface: TTunnelSurface,
): typeof MEDIA_HTTP_CAP | typeof MEDIA_HTTP_VIDEO_CAP | null => {
  if (
    surface === "video_create" ||
    surface === "video_retrieve" ||
    surface === "video_content"
  ) {
    return MEDIA_HTTP_VIDEO_CAP;
  }
  if (isMediaHttpTunnelSurface(surface)) return MEDIA_HTTP_CAP;
  return null;
};

/** Fail closed: never OPEN a media surface the peer has not advertised. */
export const peerSupportsTunnelSurface = (
  caps: readonly string[] | undefined,
  surface: TTunnelSurface,
): boolean => {
  const required = requiredMediaHttpCap(surface);
  if (required === null) return true;
  return caps?.includes(required) ?? false;
};

const TUNNEL_CONTENT_TYPE_MAX = 256;

export const ALLOWED_TUNNEL_ACCEPT = [
  "application/json",
  "text/event-stream",
  "audio/mpeg",
  "audio/wav",
  "audio/l16",
  "application/octet-stream",
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
] as const;

export type TTunnelAccept = (typeof ALLOWED_TUNNEL_ACCEPT)[number];

/**
 * Parse `name=value` / `name="quoted"` Content-Type parameters. Rejects CRLF,
 * NUL, empty names, and duplicate keys (including duplicate `boundary`).
 */
const contentTypeParams = (rest: string): Map<string, string> | null => {
  const params = new Map<string, string>();
  let i = 0;
  while (i < rest.length) {
    while (rest[i] === " " || rest[i] === "\t") i += 1;
    if (i >= rest.length) break;
    const eq = rest.indexOf("=", i);
    if (eq < 0) return null;
    const name = rest.slice(i, eq).trim().toLowerCase();
    if (name === "" || name.includes("\r") || name.includes("\n")) return null;
    if (params.has(name)) return null;
    i = eq + 1;
    if (rest[i] === '"') {
      i += 1;
      let value = "";
      while (i < rest.length) {
        const ch = rest[i];
        if (ch === "\\") {
          i += 1;
          if (i >= rest.length) return null;
          value += rest[i];
          i += 1;
          continue;
        }
        if (ch === '"') {
          i += 1;
          break;
        }
        if (ch === "\r" || ch === "\n" || ch === "\0") return null;
        value += ch;
        i += 1;
      }
      params.set(name, value);
    } else {
      const semi = rest.indexOf(";", i);
      const end = semi < 0 ? rest.length : semi;
      const value = rest.slice(i, end).trim();
      if (
        value === "" ||
        value.includes("\r") ||
        value.includes("\n") ||
        value.includes("\0")
      ) {
        return null;
      }
      params.set(name, value);
      i = end;
    }
    if (rest[i] === ";") i += 1;
    else if (i < rest.length && rest[i] !== " " && rest[i] !== "\t") {
      return null;
    }
  }
  return params;
};

/**
 * Allowlisted request Content-Type. Multipart MUST carry exactly one
 * `boundary` (quoted or token). Original spelling is preserved on success
 * so the FormData delimiter in the body still matches the header.
 */
export const isAllowedTunnelRequestContentType = (raw: string): boolean => {
  if (raw.length === 0 || raw.length > TUNNEL_CONTENT_TYPE_MAX) return false;
  if (raw.includes("\r") || raw.includes("\n") || raw.includes("\0")) {
    return false;
  }
  const slash = raw.indexOf("/");
  if (slash < 0) return false;
  const semi = raw.indexOf(";");
  const type = (semi < 0 ? raw : raw.slice(0, semi)).trim().toLowerCase();
  const params =
    semi < 0
      ? new Map<string, string>()
      : contentTypeParams(raw.slice(semi + 1));
  if (params === null) return false;
  if (type === "application/json") {
    const charset = params.get("charset");
    if (charset !== undefined && charset.toLowerCase() !== "utf-8")
      return false;
    for (const key of params.keys()) {
      if (key !== "charset") return false;
    }
    return true;
  }
  if (type === "application/octet-stream") {
    return params.size === 0;
  }
  if (type === "multipart/form-data") {
    const boundary = params.get("boundary");
    if (boundary === undefined || boundary === "") return false;
    for (const key of params.keys()) {
      if (key !== "boundary") return false;
    }
    return true;
  }
  return false;
};

export const TunnelAccept = S.Literals(ALLOWED_TUNNEL_ACCEPT);
export const TunnelRequestContentType = S.String.check(
  S.isMaxLength(TUNNEL_CONTENT_TYPE_MAX),
  S.makeFilter(isAllowedTunnelRequestContentType, {
    message: "unsupported tunnel content-type",
  }),
);

/** Speech persistence is daemon-owned unless the browser opts in and receives
 * this acknowledgement. Internal HTTP names bridge the closed mux metadata;
 * the request header is never forwarded to the cloud or provider. */
export const MEDIA_PERSISTENCE_REQUEST_HEADER = "x-openllm-media-persistence";
export const MEDIA_PERSISTENCE_RESPONSE_HEADER =
  "x-openllm-media-persistence-ack";
export const MEDIA_PERSISTENCE_BROWSER = "browser";
export const MEDIA_URL_RESPONSE_HEADER = "x-openllm-media-url";
export const TUNNEL_MEDIA_URL_MAX_LENGTH = 2048;

/**
 * Why a durable media URL is ABSENT from an otherwise successful media
 * response. Presence of {@link MEDIA_URL_RESPONSE_HEADER} is the ONLY proof
 * that the cloud library row exists; this header is what separates a serving
 * daemon that tried to persist and failed from one that never advertises
 * durability at all (an older daemon, or a surface that hands persistence to
 * the browser). Without it a consumer cannot tell a dead promise apart from
 * an unsupported one.
 *
 * Deliberately a CLOSED set of coarse categories: no URLs, no credentials,
 * no provider payloads, no byte counts — the value crosses the relay and is
 * shown to a model, so it carries a reason and nothing else.
 */
export const MEDIA_ERROR_RESPONSE_HEADER = "x-openllm-media-error";
export const MEDIA_PERSIST_ERRORS = [
  /** The cloud ingest answered, but not with success. */
  "ingest_rejected",
  /** Transport never reached a usable ingest response. */
  "ingest_unreachable",
  /** Ingest exceeded the daemon's upload budget. */
  "ingest_timeout",
  /** Ingest answered 2xx with a body the daemon could not trust. */
  "ingest_invalid_response",
  /** Persistence failed for an uncategorized reason. */
  "ingest_failed",
] as const;
export type TMediaPersistError = (typeof MEDIA_PERSIST_ERRORS)[number];
export const MediaPersistError = S.Literals(MEDIA_PERSIST_ERRORS);

const isMediaPersistError = (value: string): value is TMediaPersistError =>
  (MEDIA_PERSIST_ERRORS as ReadonlyArray<string>).includes(value);

/** The ONLY request headers a consumer may forward — a closed struct, not a
 * free map, per the relay's reviewable-vocabulary posture. Everything else
 * (auth, plan params) is the serving daemon's own business.
 *
 * Validated by the SERVING DAEMON at stream open (mux); the relay never
 * decodes it.
 */
export const TunnelForwardHeaders = S.Struct({
  media_persistence: S.optional(S.Literal(MEDIA_PERSISTENCE_BROWSER)),
  content_type: S.optional(TunnelRequestContentType),
  accept: S.optional(TunnelAccept),
  anthropic_version: S.optional(S.String.check(S.isMaxLength(32))),
  // Preserve whole flags; the mux codec bounds the complete OPEN payload.
  anthropic_beta: S.optional(S.String),
  user_agent: S.optional(S.String.check(S.isMaxLength(512))),
  /**
   * The client the consumer derived for this request (`TClientKind`) and a
   * website's host. Sent only to a daemon advertising
   * {@link CLIENT_ORIGIN_CAP}; a plain bounded string so a kind this daemon
   * doesn't know yet never fails the OPEN — it is normalized at use.
   */
  client_kind: S.optional(S.String.check(S.isMaxLength(64))),
  client_host: S.optional(
    S.String.check(S.isMaxLength(CLIENT_HOST_MAX_LENGTH)),
  ),
  /** Opaque video job id for GET retrieve/content mux follow-up. */
  video_id: S.optional(
    S.String.check(S.isMaxLength(256), S.isPattern(/^[A-Za-z0-9._-]+$/)),
  ),
  /**
   * Origin-signed team grant for this request. Mapped to
   * `x-openllm-team-grant` on the in-process `/v1` Request; the serving
   * daemon re-verifies model / local cap / kill switch. Same-user hops omit it.
   */
  team_grant: S.optional(S.String.check(S.isMaxLength(TEAM_GRANT_B64_MAX))),
  /**
   * Origin-signed hop grant for a capped key's request. Mapped to
   * `x-openllm-hop-grant` on the in-process `/v1` Request; the serving
   * daemon forwards it on its plan fetch, which returns the one granted hop
   * bound to the key's cap hold. Uncapped keys omit it.
   */
  hop_grant: S.optional(S.String.check(S.isMaxLength(HOP_GRANT_B64_MAX))),
  /**
   * The subscription provider a fleet consumer could not serve itself and
   * is asking this peer for. Mapped to {@link FLEET_PROVIDER_HEADER}; a peer
   * that can't serve it answers with {@link FLEET_DECLINE_HEADER} instead of
   * walking on to a later hop.
   */
  fleet_provider: S.optional(S.String.check(S.isMaxLength(64))),
});
export type TTunnelForwardHeaders = S.Schema.Type<typeof TunnelForwardHeaders>;

/** Response metadata carried by the mux `res_head` CTRL payload.
 *
 * Validated by the SERVING DAEMON at stream open (mux); the relay never
 * decodes it.
 */
export const TUNNEL_RESOLVED_MODEL_MAX = 256;
export const TUNNEL_CHAIN_MAX = 4096;

/** Request header: the provider a fleet consumer wants this peer to serve. */
export const FLEET_PROVIDER_HEADER = "x-openllm-fleet-provider";
/** Response header: this peer can't serve the requested fleet provider. */
export const FLEET_DECLINE_HEADER = "x-openllm-fleet-decline";
export const FLEET_DECLINE_CAUSES = [
  "not_signed_in",
  "no_quota",
  "cooling",
] as const;
export type TFleetDeclineCause = (typeof FLEET_DECLINE_CAUSES)[number];
export const isFleetDeclineCause = (
  value: string | null,
): value is TFleetDeclineCause =>
  value !== null &&
  (FLEET_DECLINE_CAUSES as ReadonlyArray<string>).includes(value);

export const TunnelResponseHeaders = S.Struct({
  media_url: S.optional(
    S.String.check(S.isMaxLength(TUNNEL_MEDIA_URL_MAX_LENGTH)),
  ),
  media_persistence: S.optional(S.Literal(MEDIA_PERSISTENCE_BROWSER)),
  /** Why `media_url` is absent — see {@link MEDIA_ERROR_RESPONSE_HEADER}. */
  media_error: S.optional(MediaPersistError),
  content_type: S.optional(S.String.check(S.isMaxLength(128))),
  is_sse: S.optional(S.Boolean),
  /** Winning hop id — maps to {@link OPENLLM_RESOLVED_MODEL_HEADER}. */
  resolved_model: S.optional(
    S.String.check(S.isMaxLength(TUNNEL_RESOLVED_MODEL_MAX)),
  ),
  /** Comma-separated attempted hops — maps to {@link OPENLLM_CHAIN_HEADER}. */
  chain: S.optional(S.String.check(S.isMaxLength(TUNNEL_CHAIN_MAX))),
  /** Maps to {@link FLEET_DECLINE_HEADER}. */
  fleet_decline: S.optional(S.Literals(FLEET_DECLINE_CAUSES)),
});
export type TTunnelResponseHeaders = S.Schema.Type<
  typeof TunnelResponseHeaders
>;

const boundedOptional = (
  value: string | null,
  max: number,
): string | undefined => {
  if (value === null || value.length === 0 || value.length > max)
    return undefined;
  return value;
};

/** Copy closed mux res_head fields onto an HTTP Headers object. */
export const applyTunnelResponseHeadersToHttp = (
  headers: Headers,
  res: TTunnelResponseHeaders,
): void => {
  if (res.media_url !== undefined) {
    headers.set(MEDIA_URL_RESPONSE_HEADER, res.media_url);
  }
  if (res.media_persistence === MEDIA_PERSISTENCE_BROWSER) {
    headers.set(MEDIA_PERSISTENCE_RESPONSE_HEADER, MEDIA_PERSISTENCE_BROWSER);
  }
  if (res.media_error !== undefined) {
    headers.set(MEDIA_ERROR_RESPONSE_HEADER, res.media_error);
  }
  if (res.content_type !== undefined) {
    headers.set("content-type", res.content_type);
  }
  if (res.resolved_model !== undefined) {
    headers.set(OPENLLM_RESOLVED_MODEL_HEADER, res.resolved_model);
  }
  if (res.chain !== undefined) {
    headers.set(OPENLLM_CHAIN_HEADER, res.chain);
  }
  if (res.fleet_decline !== undefined) {
    headers.set(FLEET_DECLINE_HEADER, res.fleet_decline);
  }
};

/** Project HTTP response headers onto the closed mux res_head struct. */
export const tunnelResponseHeadersFromHttp = (
  headers: Headers,
): TTunnelResponseHeaders => {
  const contentType = headers.get("content-type") ?? undefined;
  const mediaUrl = boundedOptional(
    headers.get(MEDIA_URL_RESPONSE_HEADER),
    TUNNEL_MEDIA_URL_MAX_LENGTH,
  );
  const resolved = boundedOptional(
    headers.get(OPENLLM_RESOLVED_MODEL_HEADER),
    TUNNEL_RESOLVED_MODEL_MAX,
  );
  const chain = boundedOptional(
    headers.get(OPENLLM_CHAIN_HEADER),
    TUNNEL_CHAIN_MAX,
  );
  const mediaError = headers.get(MEDIA_ERROR_RESPONSE_HEADER);
  return {
    ...(mediaUrl === undefined ? {} : { media_url: mediaUrl }),
    ...(mediaError !== null && isMediaPersistError(mediaError)
      ? { media_error: mediaError }
      : {}),
    ...(headers.get(MEDIA_PERSISTENCE_RESPONSE_HEADER) ===
    MEDIA_PERSISTENCE_BROWSER
      ? { media_persistence: MEDIA_PERSISTENCE_BROWSER }
      : {}),
    ...(contentType === undefined
      ? {}
      : { content_type: contentType.slice(0, 128) }),
    is_sse: contentType?.includes("text/event-stream") === true,
    ...(resolved === undefined ? {} : { resolved_model: resolved }),
    ...(chain === undefined ? {} : { chain }),
    ...(isFleetDeclineCause(headers.get(FLEET_DECLINE_HEADER))
      ? {
          fleet_decline: headers.get(
            FLEET_DECLINE_HEADER,
          ) as TFleetDeclineCause,
        }
      : {}),
  };
};

/** A channel-level admission failure. */
export const ChannelOpenError = S.Literals([
  "daemon_offline",
  "not_capable",
  "unauthorized",
  "channel_exists",
  "overloaded",
]);
export type TChannelOpenError = S.Schema.Type<typeof ChannelOpenError>;

/** A channel-level teardown reason. */
export const ChannelCloseReason = S.Literals([
  "done",
  "channel_exists",
  "consumer_gone",
  "daemon_gone",
  "relay_restart",
  "protocol_error",
  "overloaded",
]);
export type TChannelCloseReason = S.Schema.Type<typeof ChannelCloseReason>;

/** Consumer-initiated inference stream OPEN payload. */
export const TunnelStreamOpenPayload = S.Struct({
  kind: S.Literal("tunnel"),
  method: S.Literal("POST"),
  surface: TunnelSurface,
  headers: S.optional(TunnelForwardHeaders),
  consumer: S.optional(S.Literals(["browser", "daemon"])),
});
export type TTunnelStreamOpenPayload = S.Schema.Type<
  typeof TunnelStreamOpenPayload
>;

/** JSON payload of a mux OPEN frame. */
export const StreamOpenPayload = S.Union([
  TunnelStreamOpenPayload,
  AgentStreamOpenPayload,
  RealtimeStreamOpenPayload,
]);
export type TStreamOpenPayload = S.Schema.Type<typeof StreamOpenPayload>;

/** JSON payload of a mux CTRL frame. Unknown control tags are intentionally
 * not accepted here so callers can drop them for forward compatibility. */
export const StreamCtrlPayload = S.Union([
  S.Struct({
    t: S.Literal("open_ack"),
    ok: S.Boolean,
    live: S.optional(S.Boolean),
    /** Daemon-minted, monotonically increasing stream-open generation. */
    generation: S.optional(
      S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0)),
    ),
    initial_credit: S.optional(
      S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0)),
    ),
    /** Present on nacks (`ok:false`) — same vocabulary as `StreamResetCode`
     * open failures (`agent_unavailable`, `realtime_busy`, …). */
    error: S.optional(S.String.check(S.isMaxLength(64))),
    message: S.optional(S.String.check(S.isMaxLength(256))),
  }),
  S.Struct({
    t: S.Literal("res_head"),
    status: S.Number.check(
      S.isInt(),
      S.isBetween({ minimum: 200, maximum: 599 }),
    ),
    res_headers: S.optional(TunnelResponseHeaders),
  }),
  /** End of an attach replay (an agent `attach` re-emits prior events, then
   * this marker). */
  S.Struct({ t: S.Literal("replay_done") }),
  /** Browser device-session visibility; ignored by daemons predating it. */
  S.Struct({ t: S.Literal("focus") }),
  S.Struct({ t: S.Literal("blur") }),
  S.Struct({ t: S.Literal("close"), intent: S.Literals(["detach", "kill"]) }),
  /** Realtime (`kind:"realtime"`) liveness — either peer may send this while
   * NDJSON event traffic is naturally quiet (e.g. waiting on the user).
   * Carries no data; its arrival IS the signal. */
  S.Struct({ t: S.Literal("heartbeat") }),
]);
export type TStreamCtrlPayload = S.Schema.Type<typeof StreamCtrlPayload>;

/** Per-stream failure codes. Channel admission errors deliberately do not live
 * here; those use `ChannelOpenError`. A CLOSED vocabulary that only grows:
 * retired PTY codes stay so old peers keep decoding what they receive. */
export const StreamResetCode = S.Literals([
  "tunnel_refused",
  "tunnel_busy",
  "invalid_tunnel",
  "overloaded",
  /** Retired PTY mirroring. A legacy `kind:"session"` OPEN is reset with
   * this code (old browsers already decode it). */
  "pty_unsupported",
  "cli_not_installed",
  "session_not_found",
  "session_busy",
  "spawn_failed",
  "dispatch_failed",
  "timeout",
  "protocol_error",
  "peer_gone",
  /** The consumer fell behind the daemon's bounded session-output queue. */
  "lagging",
  /** Retired: remote PTY sessions used to be opt-in. Kept so old peers decode. */
  "sessions_disabled",
  /** This daemon does not (yet) serve `kind:"realtime"` — no provider
   * delegate exposes `credentialForRealtime`, or the runtime path isn't
   * wired. Mirrors `pty_unsupported`. */
  "realtime_unsupported",
  /** Max concurrent realtime sessions reached on this daemon. Mirrors
   * `tunnel_busy` / `session_busy`. */
  "realtime_busy",
  /** Admission refused for a reason OTHER than capacity — no credential
   * available (stale refresh, not logged in), or the vendor connection
   * itself failed before any event was exchanged. Retryable after the
   * underlying cause (e.g. re-login) clears. */
  "realtime_refused",
  /** The cloud's signed plan for this OPEN's `provider`/`model` was missing,
   * unsigned/tampered, unreachable, or did not resolve to exactly that hop —
   * the same account/entitlement gate every other subscription surface
   * (`planSignatureOk`) enforces before a vendor dial. Distinct from
   * `realtime_refused` (a credential-layer failure): this is a POLICY
   * refusal, and it fires before the daemon ever asks its delegate for a
   * credential. Never retryable by simply reconnecting — the caller needs a
   * plan the cloud actually signed for this provider/model. */
  "realtime_policy_refused",
  /** A seed-gated stream kind (`agent`) opened on a channel whose consumer
   * presented no valid device grant. Unlock the vault, then retry. */
  "unauthorized",
  /** This daemon advertises no agent engine handler (or it is not wired). */
  "agent_unavailable",
  /** Max concurrent agent sessions reached on this daemon. */
  "agent_busy",
  /** The daemon's device-control pin is not anchored (first-use / legacy, or
   * no install anchor): agent sessions fail closed. Fix with "Set up device
   * sessions" (`openllm login sk-llm-<key>.<anchor>`). */
  "device_not_anchored",
  /** Retired: older daemons emitted this when a separate enabled flag was off.
   * Current daemons only emit `device_not_anchored` (sessions on == anchor).
   * Kept in the closed vocabulary so old peers still decode. */
  "device_sessions_disabled",
]);
export type TStreamResetCode = S.Schema.Type<typeof StreamResetCode>;

/** JSON payload of a mux RESET frame. */
export const StreamResetPayload = S.Struct({
  code: StreamResetCode,
  message: S.optional(S.String.check(S.isMaxLength(256))),
});
export type TStreamResetPayload = S.Schema.Type<typeof StreamResetPayload>;

const parse = <T>(schema: S.ConstraintDecoder<T>, value: unknown): T | null => {
  const result = S.decodeUnknownResult(schema)(value);
  return Result.isSuccess(result) ? result.success : null;
};

const hasOnlyKeys = (
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));

/** Raw `kind` of an already-parsed OPEN JSON value, before schema decode —
 * lets a host gate or retire a kind (e.g. legacy `"session"`) that the
 * current {@link StreamOpenPayload} no longer accepts. */
export const streamOpenKindOf = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const kind: unknown = (value as { readonly kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
};

/** Mux OPEN kinds that no longer exist on the wire. A host resets them with
 * {@link RETIRED_STREAM_KIND_RESET} rather than a generic invalid-OPEN. */
export const RETIRED_STREAM_KINDS: ReadonlySet<string> = new Set(["session"]);

export const RETIRED_STREAM_KIND_RESET = {
  code: "pty_unsupported",
  message:
    "remote terminal sessions were replaced by agent sessions; reload the app",
} as const satisfies {
  readonly code: TStreamResetCode;
  readonly message: string;
};

/** Decodes an already-parsed mux OPEN JSON value, returning null on failure. */
export const parseStreamOpenPayload = (
  value: unknown,
): TStreamOpenPayload | null => {
  // Allowlist matches StreamOpenPayload union keys (tunnel + agent +
  // realtime) exactly so the filter and Schema cannot disagree.
  if (
    !hasOnlyKeys(value, [
      "kind",
      "method",
      "surface",
      "headers",
      "consumer",
      "provider",
      "model",
      "voice",
    ])
  ) {
    return null;
  }
  if (
    "headers" in value &&
    !hasOnlyKeys(value.headers, [
      "content_type",
      "accept",
      "anthropic_version",
      "anthropic_beta",
      "user_agent",
      "client_kind",
      "client_host",
      "media_persistence",
      "video_id",
      "team_grant",
      "hop_grant",
      "fleet_provider",
    ])
  ) {
    return null;
  }
  return parse(StreamOpenPayload, value);
};

/** Decodes an already-parsed mux CTRL JSON value, returning null on failure. */
export const parseStreamCtrlPayload = (
  value: unknown,
): TStreamCtrlPayload | null => parse(StreamCtrlPayload, value);

/** Decodes an already-parsed mux RESET JSON value, returning null on failure. */
export const parseStreamResetPayload = (
  value: unknown,
): TStreamResetPayload | null => parse(StreamResetPayload, value);
