/**
 * Realtime (voice) duplex session vocabulary — the supported subset only.
 *
 * Scope note: only Grok's text-to-audio realtime connection is live-verified
 * (`docs/research/subscription-provider-capabilities-2026-09-17.md`,
 * "Verified realtime audio output"). Audio INPUT, barge-in, and any event
 * outside the closed unions below are deliberately unmodeled — an unknown or
 * unsupported event is rejected by the parser, never forwarded blind. Widen
 * this file (new literals, new event variants) only after a live probe
 * verifies the addition; do not speculatively add vendor fields.
 *
 * Transport: this is payload vocabulary only. The mux `kind:"realtime"` OPEN
 * envelope lives in `./mux` (`RealtimeStreamOpenPayload`, folded into
 * `StreamOpenPayload`); the dedicated `realtime1` duplex capability is
 * `REALTIME_DUPLEX_CAP` in `./mux`. Once a stream is open, client/server
 * events defined here ride NDJSON-framed (one JSON value per `\n`-terminated
 * line) over the stream's flow-controlled DATA channel — see
 * `@openllmsh/sdk/tunnel/streams`'s `pumpRealtimeEvents` / `sendRealtimeEvent` /
 * `realtimeStream`, which import the bounds and parsers below rather than
 * duplicating them.
 */

import { Schema as S } from "effect";
import * as Result from "effect/Result";
import { GROK_TTS_VOICES } from "./audio";
import { REALTIME_MODEL_IDS } from "./realtime-generated";

/**
 * Hard per-session lifetime. The daemon (and the consumer-side helper) both
 * RESET the stream with `timeout` once reached, regardless of activity —
 * shared here so neither side can drift from the other's bound.
 */
export const REALTIME_SESSION_MAX_LIFETIME_MS = 10 * 60 * 1000;

/** Liveness heartbeat cadence once a realtime session is open. Either peer
 *  may send `{t:"heartbeat"}` (a mux CTRL frame, `StreamCtrlPayload` in
 *  `./mux`); missing ALL inbound traffic (heartbeat or otherwise) for
 *  {@link REALTIME_HEARTBEAT_TIMEOUT_MS} RESETs with `timeout`. */
export const REALTIME_HEARTBEAT_INTERVAL_MS = 15_000;
export const REALTIME_HEARTBEAT_TIMEOUT_MS = 45_000;

/**
 * Bound on ONE NDJSON realtime event line (JSON-encoded, UTF-8 bytes,
 * including the trailing `\n`). Vendor audio deltas are small PCM chunks (a
 * few KB base64 per the research probe's 107,048-byte total across many
 * deltas) — this is a generous ceiling, not the expected size. A line (or an
 * unterminated remainder) over this bound is a bounded-queue overflow, never
 * a growing buffer.
 */
export const REALTIME_MAX_EVENT_BYTES = 64 * 1024;
export const REALTIME_MAX_LINE_BYTES = REALTIME_MAX_EVENT_BYTES;

/**
 * Bound on in-flight (parsed, not-yet-delivered-to-consumer) server events a
 * daemon-side realtime session holds before treating a slow consumer as
 * `lagging` and ending the session — the realtime counterpart of the PTY
 * session's bounded output queue. Shared so the daemon's queue and any
 * future consumer-side queue agree on one number.
 */
export const REALTIME_MAX_QUEUED_EVENTS = 64;

/** Bound on one `conversation.item.create` `input_text` value. */
export const REALTIME_MAX_INPUT_TEXT_LENGTH = 4_000;

/**
 * Subscription realtime providers with a LIVE-VERIFIED connection. Grok only
 * — see the module doc. Widening this is a protocol change, not a client
 * toggle.
 */
export const RealtimeProvider = S.Literal("grok");
export type TRealtimeProvider = S.Schema.Type<typeof RealtimeProvider>;

/**
 * The realtime model verified against `wss://api.x.ai/v1/realtime`.
 *
 * The id set is CATALOG-OWNED: it comes from `./realtime-generated`, a tiny
 * artifact derived from the catalog rows declaring `capabilities:
 * ["realtime"]`. It stays a generated literal rather than a runtime lookup
 * because the SHIPPED daemon binary decodes this schema at mux admission —
 * `protocol` cannot import `packages/api`, and a runtime read would add a
 * daemon -> API dependency and break decode compat with deployed binaries.
 * `bun run check:realtime-generated` fails on drift. Widening the set is a
 * catalog change, not a client toggle.
 */
export const RealtimeModel = S.Literals(REALTIME_MODEL_IDS);
export type TRealtimeModel = S.Schema.Type<typeof RealtimeModel>;

/** Reuses the verified Grok TTS voice list — never duplicate that literal. */
export const RealtimeVoice = S.Literals(GROK_TTS_VOICES);
export type TRealtimeVoice = S.Schema.Type<typeof RealtimeVoice>;

/** Only PCM16 at 24kHz was exercised on the realtime connection. */
export const RealtimeOutputAudioFormat = S.Literal("pcm16_24khz");
export type TRealtimeOutputAudioFormat = S.Schema.Type<
  typeof RealtimeOutputAudioFormat
>;

/**
 * Mux `kind:"realtime"` OPEN payload — folded into `StreamOpenPayload` in
 * `./mux`. Declaring `voice`/`model` here (not only inside `session.update`)
 * lets the serving daemon refuse an unsupported combination before it ever
 * dials the vendor.
 */
export const RealtimeStreamOpenPayload = S.Struct({
  kind: S.Literal("realtime"),
  provider: RealtimeProvider,
  model: RealtimeModel,
  voice: RealtimeVoice,
});
export type TRealtimeStreamOpenPayload = S.Schema.Type<
  typeof RealtimeStreamOpenPayload
>;

// ---------------------------------------------------------------------------
// Client → server events (the consumer sends these)
// ---------------------------------------------------------------------------

/** Disabled server-side turn detection — the only mode verified (text input
 *  only; no microphone/VAD turn-taking has been tested). */
const RealtimeTurnDetectionDisabled = S.Struct({ type: S.Null });

export const RealtimeSessionUpdateEvent = S.Struct({
  type: S.Literal("session.update"),
  session: S.Struct({
    voice: RealtimeVoice,
    output_audio_format: RealtimeOutputAudioFormat,
    turn_detection: RealtimeTurnDetectionDisabled,
  }),
});
export type TRealtimeSessionUpdateEvent = S.Schema.Type<
  typeof RealtimeSessionUpdateEvent
>;

const RealtimeInputTextContent = S.Struct({
  type: S.Literal("input_text"),
  text: S.String.check(
    S.isMinLength(1),
    S.isMaxLength(REALTIME_MAX_INPUT_TEXT_LENGTH),
  ),
});

/** Text-only conversation item — audio input is unmodeled (module doc). */
export const RealtimeConversationItemCreateEvent = S.Struct({
  type: S.Literal("conversation.item.create"),
  item: S.Struct({
    type: S.Literal("message"),
    role: S.Literal("user"),
    content: S.Array(RealtimeInputTextContent).check(
      S.isMinLength(1),
      S.isMaxLength(1),
    ),
  }),
});
export type TRealtimeConversationItemCreateEvent = S.Schema.Type<
  typeof RealtimeConversationItemCreateEvent
>;

export const RealtimeResponseCreateEvent = S.Struct({
  type: S.Literal("response.create"),
});
export type TRealtimeResponseCreateEvent = S.Schema.Type<
  typeof RealtimeResponseCreateEvent
>;

/** The entire supported client→server vocabulary. Anything else fails to
 *  parse and is dropped rather than forwarded upstream. */
export const RealtimeClientEvent = S.Union([
  RealtimeSessionUpdateEvent,
  RealtimeConversationItemCreateEvent,
  RealtimeResponseCreateEvent,
]);
export type TRealtimeClientEvent = S.Schema.Type<typeof RealtimeClientEvent>;

// ---------------------------------------------------------------------------
// Server → client events (the vendor, normalized, sends these)
// ---------------------------------------------------------------------------

export const RealtimeSessionCreatedEvent = S.Struct({
  type: S.Literal("session.created"),
});
export const RealtimeSessionUpdatedEvent = S.Struct({
  type: S.Literal("session.updated"),
});
export const RealtimeResponseCreatedEvent = S.Struct({
  type: S.Literal("response.created"),
});

export const RealtimeResponseOutputAudioDeltaEvent = S.Struct({
  type: S.Literal("response.output_audio.delta"),
  /** Base64-encoded PCM16/24kHz chunk. */
  delta: S.String.check(
    S.isMinLength(1),
    S.isMaxLength(REALTIME_MAX_EVENT_BYTES),
  ),
});
export const RealtimeResponseOutputAudioTranscriptDeltaEvent = S.Struct({
  type: S.Literal("response.output_audio_transcript.delta"),
  delta: S.String.check(S.isMaxLength(REALTIME_MAX_EVENT_BYTES)),
});
export const RealtimeResponseOutputAudioDoneEvent = S.Struct({
  type: S.Literal("response.output_audio.done"),
});
export const RealtimeResponseDoneEvent = S.Struct({
  type: S.Literal("response.done"),
});

/** Normalized refusal/failure surfaced to the consumer in-band (distinct
 *  from a mux-level RESET, which ends the whole stream). */
export const RealtimeErrorEvent = S.Struct({
  type: S.Literal("error"),
  code: S.String.check(S.isMinLength(1), S.isMaxLength(64)),
  message: S.optional(S.String.check(S.isMaxLength(256))),
});
export type TRealtimeErrorEvent = S.Schema.Type<typeof RealtimeErrorEvent>;

/** The entire supported server→client vocabulary. An unrecognized vendor
 *  event (or a shape that doesn't match one of these) is DROPPED by the
 *  daemon, never relayed verbatim — see `realtime-session.ts`. */
export const RealtimeServerEvent = S.Union([
  RealtimeSessionCreatedEvent,
  RealtimeSessionUpdatedEvent,
  RealtimeResponseCreatedEvent,
  RealtimeResponseOutputAudioDeltaEvent,
  RealtimeResponseOutputAudioTranscriptDeltaEvent,
  RealtimeResponseOutputAudioDoneEvent,
  RealtimeResponseDoneEvent,
  RealtimeErrorEvent,
]);
export type TRealtimeServerEvent = S.Schema.Type<typeof RealtimeServerEvent>;

const parse = <T>(schema: S.ConstraintDecoder<T>, value: unknown): T | null => {
  const result = S.decodeUnknownResult(schema)(value);
  return Result.isSuccess(result) ? result.success : null;
};

export const parseRealtimeClientEvent = (
  value: unknown,
): TRealtimeClientEvent | null => parse(RealtimeClientEvent, value);

export const parseRealtimeServerEvent = (
  value: unknown,
): TRealtimeServerEvent | null => parse(RealtimeServerEvent, value);

// ---------------------------------------------------------------------------
// NDJSON line framing over the mux DATA channel
// ---------------------------------------------------------------------------

const lineEncoder = new TextEncoder();
const lineDecoder = new TextDecoder();
const NEWLINE = 0x0a;

/**
 * Encode one realtime event as an NDJSON line (`JSON.stringify(event) +
 * "\n"`, UTF-8). Returns null on a non-serializable value or when the
 * encoded line would exceed {@link REALTIME_MAX_LINE_BYTES} — callers must
 * treat either as "do not send", never truncate.
 */
export const encodeRealtimeEventLine = (event: unknown): Uint8Array | null => {
  let text: string;
  try {
    text = JSON.stringify(event);
  } catch {
    return null;
  }
  if (text === undefined) return null;
  const encoded = lineEncoder.encode(`${text}\n`);
  if (encoded.byteLength > REALTIME_MAX_LINE_BYTES) return null;
  return encoded;
};

/** Decode one NDJSON line's raw bytes into an unknown JSON value, or
 *  `undefined` on malformed UTF-8/JSON. */
export const decodeRealtimeLine = (line: Uint8Array): unknown | undefined => {
  try {
    return JSON.parse(lineDecoder.decode(line));
  } catch {
    return undefined;
  }
};

export type TRealtimeLineSplitResult = {
  readonly lines: readonly Uint8Array[];
  readonly remainder: Uint8Array;
};

/**
 * Append `chunk` to a carried-over `remainder` and split on `\n`. Pure and
 * allocation-bounded: the transient `combined` buffer is at most
 * `remainder.byteLength + chunk.byteLength`, and this function is called
 * once per inbound DATA frame (already bounded to the mux's own
 * `MAX_PAYLOAD_BYTES`), so a caller that rejects a null result before the
 * next call never accumulates past one frame beyond the line bound.
 *
 * Returns null when EITHER a newline-terminated segment OR the trailing
 * not-yet-terminated remainder would exceed {@link REALTIME_MAX_LINE_BYTES}
 * — callers MUST treat that as a bounded-queue overflow (RESET `lagging`),
 * never grow the buffer further. Checking only the tail is not enough: the
 * mux's own `MAX_PAYLOAD_BYTES` (256 KiB) is larger than
 * `REALTIME_MAX_LINE_BYTES` (64 KiB), so a single inbound DATA frame can by
 * itself carry a newline-terminated segment well past the line bound —
 * that segment must be rejected before it is ever handed to
 * `decodeRealtimeLine`/`JSON.parse`, not silently accepted because it
 * happened to end in `\n`.
 */
export const splitRealtimeLines = (
  remainder: Uint8Array,
  chunk: Uint8Array,
): TRealtimeLineSplitResult | null => {
  const combined = new Uint8Array(remainder.byteLength + chunk.byteLength);
  combined.set(remainder, 0);
  combined.set(chunk, remainder.byteLength);
  const lines: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < combined.byteLength; i += 1) {
    if (combined[i] === NEWLINE) {
      if (i - start > REALTIME_MAX_LINE_BYTES) return null;
      lines.push(combined.subarray(start, i));
      start = i + 1;
    }
  }
  const tail = combined.subarray(start);
  if (tail.byteLength > REALTIME_MAX_LINE_BYTES) return null;
  return { lines, remainder: tail };
};
