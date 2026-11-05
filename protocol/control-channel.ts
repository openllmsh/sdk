import { Schema as S } from "effect";
import { AccountIndex, DaemonCommandKind } from "./daemon";

// ─── Control channel — the live command lifecycle ────────────────────
//
// The stateless-relay contract: the relay is a pure socket binder (Browser
// WS ↔ Daemon WS) and the daemon is the source of truth. A command is a
// self-contained request → lifecycle → response with NO persistence — no
// `daemon_commands` mailbox, no history, no replay (it lives only as long as
// its sockets). This file owns the command lifecycle the browser drives its
// optimistic UI off; `device-state.ts` owns the snapshot the daemon pushes.
// See `docs/proposals/daemon-owned-state-stateless-relay.md`.
//
// NB: distinct from the daemon's local `packages/cli/daemon/src/control-channel.ts`
// (the partysocket transport impl). This is the SHARED wire contract both ends
// and the relay decode against.

export type { TDaemonCommand, TDaemonCommandKind } from "./daemon";
// Re-export the closed command vocabulary so a consumer can import the whole
// control-channel contract from one module.
export { DaemonCommand, DaemonCommandKind } from "./daemon";

/** Informational relay protocol version; feature gating is caps-based. */
export const RELAY_PROTOCOL_VERSION = 3;

/**
 * The command lifecycle — daemon-asserted, pushed live over the socket.
 * Replaces the old `DaemonCommandAck { status: "done" | "error" }` binary with
 * a five-state progression:
 *
 *   pending  — browser → relay sent; no daemon ack yet (browser-local).
 *   ack      — the daemon received the command and began running it.
 *   done     — completed; the `-s` probe shows the box state actually changed.
 *   not_done — completed; the `-s` probe shows it was already in the desired
 *              state (a measured no-op). Reserved for a daemon-measured no-op —
 *              NEVER a transport rejection (an offline daemon yields `error`).
 *   error    — failed (or the relay had no live daemon socket: `daemon_offline`);
 *              carries `message`.
 *
 * `done`/`not_done` for the install/uninstall family come from the pre/post
 * `install.sh -s` probe (a measured fact, not a handler claim); commands with no
 * `-s` probe (connect/logout/refresh/…) return them from the handler.
 *
 * Subscription login is NOT a CommandState. See `auth.ts` (`auth.login.*` /
 * `auth.session.lost`) — do not overload this union with auth phases.
 */
export const CommandState = S.Literals([
  "pending",
  "ack",
  "done",
  "not_done",
  "error",
]);
export type TCommandState = S.Schema.Type<typeof CommandState>;

/** The terminal subset of `CommandState` — the states a command finally rests
 *  in. `pending`/`ack` are transient. */
export const TerminalCommandState = S.Literals(["done", "not_done", "error"]);
export type TTerminalCommandState = S.Schema.Type<typeof TerminalCommandState>;

/**
 * One snapshot of a command's progress. `req_id` is the id the browser minted at
 * enqueue (the relay echoes it back — always present). `slug` is the command's
 * target provider when it has one (connect/logout/…), so the browser can release
 * the optimistic-pending ticket for THAT provider only — absent for whole-daemon
 * commands (refresh/auto-update), where the browser falls back to clearing the
 * key's tickets. `kind` is informational (display / dedup). `message` is a brief,
 * human-readable line set on `error` (e.g. `daemon_offline`) and optionally on
 * `not_done`.
 */
export const CommandLifecycle = S.Struct({
  req_id: S.String,
  command_id: S.optional(S.String),
  key_id: S.String,
  daemon_session_id: S.optional(S.String),
  slug: S.optional(S.String),
  target: S.optional(S.String),
  /**
   * Device-local account slot this lifecycle clears in the dashboard
   * (`docs/plan/multi-account-subscriptions.md`). Absent ⇒ account 0 so
   * older relays / single-account tickets keep the bare `(keyId, slug)`
   * pending key. Roster commands (`add_account` / `remove_account` /
   * `pin_account`) leave this unset and scope via a `${slug}#roster`
   * ticket instead.
   */
  account_index: S.optional(AccountIndex),
  kind: DaemonCommandKind,
  state: CommandState,
  message: S.optional(S.String),
  /**
   * Optional command-specific payload (e.g. `list_local_sessions` →
   * `{ sessions: LocalCliSession[] }`). Absent on most commands; the
   * browser must ignore unknown shapes. Never carries secrets.
   */
  result: S.optional(S.Unknown),
});
export type TCommandLifecycle = S.Schema.Type<typeof CommandLifecycle>;

// ─── New relay → watcher frames (stateless-relay transport) ──────────
//
// These supersede the old `enqueue_ack` / `status_push` / `presence` frames in
// `relay.ts` once Phase 3 lands. Defined additively here so later phases import
// a stable contract; the full `RelayFrame` union swap happens with the relay
// rewrite.

/** relay → watcher. A live update on a command the watcher enqueued. The
 *  terminal frame (`done`/`not_done`/`error`) is the receipt — there is no
 *  durable row to read back. */
export const RelayCommandLifecycleFrame = S.Struct({
  type: S.Literal("command_lifecycle"),
  lifecycle: CommandLifecycle,
});
export type TRelayCommandLifecycleFrame = S.Schema.Type<
  typeof RelayCommandLifecycleFrame
>;
