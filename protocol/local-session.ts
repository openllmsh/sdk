/**
 * Local terminal session-host vocabulary.
 *
 * `openllm <client>` / `openllm sessions` attach a REAL terminal on the same
 * machine to the daemon's durable PTY session-host over a local unix socket.
 * That broker keeps the PTY open/control shapes below. They are NOT a mux
 * wire kind any more: remote PTY mirroring was replaced by agent sessions
 * (`./agent`, mux `kind:"agent"`), and a legacy `kind:"session"` mux OPEN is
 * reset by the daemon (docs/plan/2026-10-23-agent-sessions-replace-remote-pty.md).
 */
import { Schema as S } from "effect";
import * as Result from "effect/Result";
import {
  DeviceSessionCli,
  SessionTitleField,
  supportsDangerousSession,
} from "./daemon";

/** Session ids are client-minted url-safe tokens. The url-safe pattern is
 * required because the id is embedded in the session-host pidfile name
 * (`<id>.pid`). */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const SessionId = S.String.check(S.isPattern(SESSION_ID_PATTERN));
export type TSessionId = S.Schema.Type<typeof SessionId>;

/** Terminal cols/rows on local session open + resize. */
export const TerminalDimension = S.Number.check(
  S.isInt(),
  S.isBetween({ minimum: 1, maximum: 1024 }),
);
export type TTerminalDimension = S.Schema.Type<typeof TerminalDimension>;

/** Open request on the local session-host broker. */
export const LocalSessionOpenPayload = S.Struct({
  kind: S.Literal("session"),
  session_id: SessionId,
  cli: DeviceSessionCli,
  cols: TerminalDimension,
  rows: TerminalDimension,
  mode: S.Literals(["spawn", "attach", "continue"]),
  title: S.optional(SessionTitleField),
  /** When true, launch via `openllm -d <client>` for CLIs that support it. */
  dangerous: S.optional(S.Boolean),
  /** Cold-resume a vendor session by id (`spawn` only). */
  resume_session_id: S.optional(
    S.String.check(S.isMinLength(1), S.isMaxLength(128)),
  ),
  /** Absolute cwd for spawn/continue; omitted → `$HOME` for new sessions. */
  cwd: S.optional(S.String.check(S.isMinLength(1), S.isMaxLength(1024))),
  /**
   * `attach` only: a structured observer (the daemon's agent engine). It reads
   * output and writes input but is not a viewer: it never drives the PTY size
   * and does not count as attached for detach / idle reap.
   */
  observer: S.optional(S.Boolean),
});
export type TLocalSessionOpenPayload = S.Schema.Type<
  typeof LocalSessionOpenPayload
>;

/** Control messages on the local session-host broker. */
export const LocalSessionCtrlPayload = S.Union([
  S.Struct({
    t: S.Literal("open_ack"),
    ok: S.Boolean,
    live: S.optional(S.Boolean),
    generation: S.optional(
      S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0)),
    ),
    error: S.optional(S.String.check(S.isMaxLength(64))),
    message: S.optional(S.String.check(S.isMaxLength(256))),
  }),
  S.Struct({
    t: S.Literal("resize"),
    cols: TerminalDimension,
    rows: TerminalDimension,
  }),
  /** Viewer became the active (focused) consumer — bumps primary election. */
  S.Struct({ t: S.Literal("focus") }),
  /** An observer left the browser surface; terminal retakes ad placement. */
  S.Struct({ t: S.Literal("blur") }),
  S.Struct({ t: S.Literal("replay_done") }),
  S.Struct({ t: S.Literal("close"), intent: S.Literals(["detach", "kill"]) }),
]);
export type TLocalSessionCtrlPayload = S.Schema.Type<
  typeof LocalSessionCtrlPayload
>;

const decodeOpen = S.decodeUnknownResult(
  S.revealCodec(LocalSessionOpenPayload),
);
const decodeCtrl = S.decodeUnknownResult(
  S.revealCodec(LocalSessionCtrlPayload),
);

/** Decode a local session open, enforcing the cross-field rules, or null. */
export const parseLocalSessionOpenPayload = (
  value: unknown,
): TLocalSessionOpenPayload | null => {
  const result = decodeOpen(value);
  if (Result.isFailure(result)) return null;
  const open = result.success;
  if (open.dangerous === true && !supportsDangerousSession(open.cli))
    return null;
  if (open.cli === "shell" && open.resume_session_id !== undefined) return null;
  if (open.resume_session_id !== undefined && open.mode !== "spawn")
    return null;
  if (open.cwd !== undefined && open.mode === "attach") return null;
  return open;
};

/** Decode a local session control message, or null (unknown tags too). */
export const parseLocalSessionCtrlPayload = (
  value: unknown,
): TLocalSessionCtrlPayload | null => {
  const result = decodeCtrl(value);
  return Result.isSuccess(result) ? result.success : null;
};
