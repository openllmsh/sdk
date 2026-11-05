/**
 * Agent session protocol — the structured replacement for remote PTY
 * mirroring (docs/plan/2026-10-23-agent-sessions-replace-remote-pty.md).
 *
 * A consumer opens a mux stream with {@link AgentStreamOpenPayload}
 * (`kind:"agent"`, seed-gated on the daemon) or reaches the daemon's loopback
 * agent endpoint, then exchanges NDJSON lines over the flow-controlled DATA
 * channel:
 *
 *   consumer → daemon : {@link AgentCommand} (start / attach / send /
 *                        interrupt / respond / close / attachment_get /
 *                        set_model / delete_session / history_get)
 *   daemon → consumer : {@link AgentEvent} (session / turn / item / content /
 *                        request / user-input / token-usage / runtime /
 *                        attachment.data / history.page)
 *
 * History is paged (after t3code's windowed thread detail): an attach replays
 * only the LATEST window of the session, ending on a turn boundary, then a
 * {@link AgentHistoryPageEvent} names the opaque cursor before that window.
 * `history_get{before}` returns the adjacent, strictly older page.
 *
 * The event families are a trimmed subset of t3code's `ProviderRuntimeEvent`:
 * no multi-CLI orchestration, no event-sourcing / checkpoint / git tooling, no
 * terminal drawer, no realtime-audio, account or MCP-OAuth events. Every
 * engine adapter on the daemon emits this one stream, so the UI renders one
 * vocabulary whichever engine runs the session.
 *
 * Forward compatibility: an event whose `type` this build does not know
 * decodes to `null` and is dropped by consumers. Commands are validated
 * strictly by the serving daemon.
 */
import { Schema as S } from "effect";
import * as Result from "effect/Result";
import { SESSION_ID_PATTERN } from "./local-session";

/**
 * Capability advertising `kind:"agent"` stream support. Consumers MUST check
 * {@link hasAgentCap} before OPEN; a peer without it gets "update your device".
 */
export const AGENT_CAP = "agent1";

/** Returns whether an open-vocabulary capability list advertises agent sessions. */
export const hasAgentCap = (caps: readonly string[] | undefined): boolean =>
  caps?.includes(AGENT_CAP) ?? false;

/**
 * Bound on ONE NDJSON agent line (JSON-encoded UTF-8 bytes, including the
 * trailing `\n`). Larger than the realtime bound because a `send` command may
 * carry inline attachments; a line (or unterminated remainder) over the bound
 * is an overflow, never a growing buffer.
 */
export const AGENT_MAX_LINE_BYTES = 8 * 1024 * 1024;

const lineEncoder = new TextEncoder();

/** Max characters of one prompt. */
export const AGENT_MAX_PROMPT_LENGTH = 1024 * 1024;

/**
 * Daemon loopback route Claude's hooks post to (`openllm exec agent hook`):
 * busy/idle and PermissionRequest for agent sessions. Admitted like the other
 * `/local/*` routes (loopback peer + Host, local control capability).
 * Body: `{session_id, event, payload}`; reply: `{output}` (the hook's stdout
 * JSON) or `{}` for no output.
 */
export const AGENT_HOOK_LOCAL_PATH = "/local/agent-hook";
/**
 * Claude hook events `openllm exec agent hook` forwards. `SessionStart` is the
 * engine's readiness signal: Claude runs it once the TUI is up (after any
 * folder-trust dialog), so a queued web prompt is pasted only then.
 */
export const AGENT_HOOK_EVENTS = [
  "PermissionRequest",
  "PreToolUse",
  "Stop",
  "SessionStart",
] as const;

/** Max inline attachments on one `send`. */
export const AGENT_MAX_ATTACHMENTS = 8;

/** Max base64 characters of one inline attachment. */
export const AGENT_MAX_ATTACHMENT_BASE64_LENGTH = 6 * 1024 * 1024;

/**
 * Engines an agent session can run. Each id is the `openllm <client>` the
 * daemon launches the engine through (same overlay, gateway URL, key, model
 * mapping), so a session's inference is routed through openllm whatever
 * model the user picked.
 */
export const AgentEngine = S.Literals(["claude", "codex"]);
export type TAgentEngine = S.Schema.Type<typeof AgentEngine>;

/**
 * Agent session id: daemon-minted (a UUID), the consumer's own record id, or
 * a vendor session id for attach/resume (Claude / Codex ids are UUIDs). The
 * id names the session host's registry dir and its attachments dir, so it is
 * the local session id itself: url-safe, no `.`, so never `.` / `..`.
 */
export const AGENT_SESSION_ID_PATTERN = SESSION_ID_PATTERN;
export const AgentSessionId = S.String.check(
  S.isPattern(AGENT_SESSION_ID_PATTERN),
);
export type TAgentSessionId = S.Schema.Type<typeof AgentSessionId>;

/** Opaque daemon-minted id for turns, items, and requests. */
const AgentRefId = S.String.check(S.isMinLength(1), S.isMaxLength(128));

/** Optional consumer-minted command id, echoed on correlated events. */
const AgentCommandId = S.String.check(S.isMinLength(1), S.isMaxLength(64));

const AgentModel = S.String.check(S.isMinLength(1), S.isMaxLength(256));

/** Absolute directory; the daemon validates it exists before starting. */
const AgentCwd = S.String.check(S.isMinLength(1), S.isMaxLength(1024));

/**
 * Length caps (UTF-16 code units, as `String.length`) of an event's short
 * label fields (titles, messages, option labels), its detail text, and a tool
 * call's `tool_name`. An event over one fails to decode and consumers drop it,
 * so builders clip to these.
 */
export const AGENT_SHORT_TEXT_MAX_LENGTH = 256;
export const AGENT_DETAIL_TEXT_MAX_LENGTH = 16 * 1024;
export const AGENT_TOOL_NAME_MAX_LENGTH = 128;

const ShortText = S.String.check(S.isMaxLength(AGENT_SHORT_TEXT_MAX_LENGTH));
const DetailText = S.String.check(S.isMaxLength(AGENT_DETAIL_TEXT_MAX_LENGTH));

// ---------------------------------------------------------------------------
// Stream OPEN
// ---------------------------------------------------------------------------

/**
 * Mux `kind:"agent"` OPEN payload — folded into `StreamOpenPayload` in
 * `./mux`. Carries nothing but the kind: the session itself is driven by
 * {@link AgentCommand} lines on the stream, so one OPEN shape serves start,
 * attach and resume.
 */
export const AgentStreamOpenPayload = S.Struct({
  kind: S.Literal("agent"),
});
export type TAgentStreamOpenPayload = S.Schema.Type<
  typeof AgentStreamOpenPayload
>;

// ---------------------------------------------------------------------------
// Commands (consumer → daemon)
// ---------------------------------------------------------------------------

export const AgentAttachment = S.Struct({
  kind: S.Literals(["image", "file"]),
  name: S.optional(S.String.check(S.isMinLength(1), S.isMaxLength(256))),
  media_type: S.String.check(S.isMinLength(1), S.isMaxLength(128)),
  /** Base64 bytes. */
  data: S.String.check(S.isMaxLength(AGENT_MAX_ATTACHMENT_BASE64_LENGTH)),
});
export type TAgentAttachment = S.Schema.Type<typeof AgentAttachment>;

/**
 * Metadata for an attachment that was saved on the device for a turn. The
 * `name` is the on-disk basename under the session's attachments dir (what
 * {@link AgentAttachmentGetCommand} looks up) — not the original upload name
 * when they differ. Optional on `turn.started` so terminal prompts and older
 * daemons stay compatible.
 */
export const AgentAttachmentMeta = S.Struct({
  name: S.String.check(S.isMinLength(1), S.isMaxLength(256)),
  mime: S.String.check(S.isMinLength(1), S.isMaxLength(128)),
  size: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0)),
});
export type TAgentAttachmentMeta = S.Schema.Type<typeof AgentAttachmentMeta>;

/** Decoded-byte cap mirroring {@link AGENT_MAX_ATTACHMENT_BASE64_LENGTH}. */
export const AGENT_MAX_ATTACHMENT_BYTES = Math.floor(
  (AGENT_MAX_ATTACHMENT_BASE64_LENGTH * 3) / 4,
);

/** Decision on an approval request (`request.opened`). */
export const AgentRequestDecision = S.Literals([
  "accept",
  "accept_for_session",
  "decline",
  "cancel",
]);
export type TAgentRequestDecision = S.Schema.Type<typeof AgentRequestDecision>;

/** Answers to a `user-input.requested`, keyed by question id. */
export const AgentUserInputAnswers = S.Record(
  S.String.check(S.isMinLength(1), S.isMaxLength(128)),
  S.Union([
    S.String.check(S.isMaxLength(16 * 1024)),
    S.Array(S.String.check(S.isMaxLength(1024))).check(S.isMaxLength(64)),
  ]),
);
export type TAgentUserInputAnswers = S.Schema.Type<
  typeof AgentUserInputAnswers
>;

export const AgentStartCommand = S.Struct({
  type: S.Literal("start"),
  id: S.optional(AgentCommandId),
  engine: AgentEngine,
  /** Gateway model id; omitted → the engine's openllm default. */
  model: S.optional(AgentModel),
  /** Omitted → the daemon user's home directory. */
  cwd: S.optional(AgentCwd),
  /**
   * Per-session opt-in to the engine's skip-permissions mode
   * (`--dangerously-skip-permissions` or the vendor equivalent). Default off:
   * approvals surface as `request.opened` events.
   */
  skip_permissions: S.optional(S.Boolean),
  title: S.optional(S.String.check(S.isMaxLength(80))),
  /**
   * The id the new session takes (the consumer's own record id, e.g. the web's
   * cloud session row). Omitted → the daemon mints one. One id end to end (the
   * cloud row, the session host, Claude's transcript) is what lets a reload
   * re-attach and a running row match the daemon's status.
   */
  session_id: S.optional(AgentSessionId),
});
export type TAgentStartCommand = S.Schema.Type<typeof AgentStartCommand>;

export const AgentAttachCommand = S.Struct({
  type: S.Literal("attach"),
  id: S.optional(AgentCommandId),
  session_id: AgentSessionId,
  /** Engine of the target session when the consumer knows it (local index). */
  engine: S.optional(AgentEngine),
});
export type TAgentAttachCommand = S.Schema.Type<typeof AgentAttachCommand>;

export const AgentSendCommand = S.Struct({
  type: S.Literal("send"),
  id: S.optional(AgentCommandId),
  prompt: S.String.check(S.isMaxLength(AGENT_MAX_PROMPT_LENGTH)),
  attachments: S.optional(
    S.Array(AgentAttachment).check(S.isMaxLength(AGENT_MAX_ATTACHMENTS)),
  ),
}).check(
  S.makeFilter(
    (command) =>
      lineEncoder.encode(`${JSON.stringify(command)}\n`).byteLength <=
      AGENT_MAX_LINE_BYTES,
    { message: "send command exceeds the agent line size bound" },
  ),
);
export type TAgentSendCommand = S.Schema.Type<typeof AgentSendCommand>;

/**
 * Deliver the queued prompts NOW instead of after the running turn. Plain,
 * they join the running turn at its next tool boundary and running tools
 * finish. With `interrupt`, the engine's own send-now (Claude Code's
 * ctrl+enter) runs: running shells move to the background and tools that
 * can't (an MCP call) are stopped — consumers ask the user before setting it.
 * A daemon that predates it rejects the line; consumers offer it only after
 * a `queue.updated` showed the daemon queues.
 */
export const AgentSendNowCommand = S.Struct({
  type: S.Literal("send_now"),
  id: S.optional(AgentCommandId),
  interrupt: S.optional(S.Boolean),
});
export type TAgentSendNowCommand = S.Schema.Type<typeof AgentSendNowCommand>;

/** Resume a queue that an interrupt deliberately paused. */
export const AgentResumeQueueCommand = S.Struct({
  type: S.Literal("resume_queue"),
  id: S.optional(AgentCommandId),
});
export type TAgentResumeQueueCommand = S.Schema.Type<
  typeof AgentResumeQueueCommand
>;

/** Remove one queued prompt without affecting the active turn. */
export const AgentCancelQueuedCommand = S.Struct({
  type: S.Literal("cancel_queued"),
  id: S.optional(AgentCommandId),
  queue_id: AgentRefId,
});
export type TAgentCancelQueuedCommand = S.Schema.Type<
  typeof AgentCancelQueuedCommand
>;

export const AgentInterruptCommand = S.Struct({
  type: S.Literal("interrupt"),
  id: S.optional(AgentCommandId),
  /** Omitted → the active turn. */
  turn_id: S.optional(AgentRefId),
});
export type TAgentInterruptCommand = S.Schema.Type<
  typeof AgentInterruptCommand
>;

/**
 * Answer a pending approval (`decision`) or user-input request (`answers`).
 * Exactly one of the two is present.
 */
export const AgentRespondCommand = S.Struct({
  type: S.Literal("respond"),
  id: S.optional(AgentCommandId),
  request_id: AgentRefId,
  decision: S.optional(AgentRequestDecision),
  answers: S.optional(AgentUserInputAnswers),
}).check(
  S.makeFilter(
    (command) =>
      (command.decision === undefined) !== (command.answers === undefined),
    {
      message: "respond carries exactly one of decision / answers",
    },
  ),
);
export type TAgentRespondCommand = S.Schema.Type<typeof AgentRespondCommand>;

export const AgentCloseCommand = S.Struct({
  type: S.Literal("close"),
  id: S.optional(AgentCommandId),
});
export type TAgentCloseCommand = S.Schema.Type<typeof AgentCloseCommand>;

/**
 * Fetch one attachment from the current session's on-device attachments dir.
 * `name` is the basename recorded on `turn.started.attachments` (no path
 * separators). The daemon refuses traversal / absolute / symlink-escape names
 * and streams the bytes back as one or more {@link AgentAttachmentDataEvent}
 * lines under the same `command_id`.
 */
export const AgentAttachmentGetCommand = S.Struct({
  type: S.Literal("attachment_get"),
  id: S.optional(AgentCommandId),
  name: S.String.check(S.isMinLength(1), S.isMaxLength(256)),
});
export type TAgentAttachmentGetCommand = S.Schema.Type<
  typeof AgentAttachmentGetCommand
>;

/**
 * A model id a running session can switch to: gateway ids and Claude aliases
 * (`ultra`, `sonnet`, `openai/gpt-5`, `claude-opus-4-5[1m]`). No whitespace or
 * control characters: it is typed into the engine's own `/model` command.
 */
export const AGENT_SWITCH_MODEL_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,255}$/;

/**
 * Switch the running session's model (Claude: its own `/model <id>`, applied
 * when the session is idle, queued while a turn runs). Confirmed by a
 * `session.configured` event once the engine reports the change.
 */
export const AgentSetModelCommand = S.Struct({
  type: S.Literal("set_model"),
  id: S.optional(AgentCommandId),
  model: S.String.check(S.isPattern(AGENT_SWITCH_MODEL_PATTERN)),
});
export type TAgentSetModelCommand = S.Schema.Type<typeof AgentSetModelCommand>;

/**
 * Delete one session from this device: stop its process if it runs (here or
 * in a terminal), then remove its attachments, Claude's transcript
 * (`~/.claude/projects/<slug of its cwd>/<id>.jsonl`) and its lines in
 * `~/.claude/history.jsonl`. Stream-level (needs no bound session). Answered
 * by `session.deleted`, or a `runtime.error`. `close` is the non-destructive
 * Stop: it kills the process and keeps the history.
 */
export const AgentDeleteSessionCommand = S.Struct({
  type: S.Literal("delete_session"),
  id: S.optional(AgentCommandId),
  session_id: AgentSessionId,
});
export type TAgentDeleteSessionCommand = S.Schema.Type<
  typeof AgentDeleteSessionCommand
>;

/** Turns one `history_get` page holds at most. */
export const AGENT_HISTORY_MAX_PAGE_TURNS = 100;
/** Events one `history.page` carries at most. */
export const AGENT_HISTORY_MAX_PAGE_EVENTS = 4_000;

/** Opaque daemon-minted history cursor (consumers never parse it). */
const AgentHistoryCursor = S.String.check(S.isMinLength(1), S.isMaxLength(128));

/**
 * Older history of the bound session: the turns strictly before `before`
 * (a cursor from an earlier `history.page`), newest `limit` of them. Answered
 * by one `history.page` carrying the events, under the same `command_id`.
 */
export const AgentHistoryGetCommand = S.Struct({
  type: S.Literal("history_get"),
  id: S.optional(AgentCommandId),
  before: AgentHistoryCursor,
  limit: S.optional(
    S.Number.check(
      S.isInt(),
      S.isGreaterThan(0),
      S.isLessThanOrEqualTo(AGENT_HISTORY_MAX_PAGE_TURNS),
    ),
  ),
});
export type TAgentHistoryGetCommand = S.Schema.Type<
  typeof AgentHistoryGetCommand
>;

/** One consumer → daemon command line. */
export const AgentCommand = S.Union([
  AgentStartCommand,
  AgentAttachCommand,
  AgentSendCommand,
  AgentSendNowCommand,
  AgentResumeQueueCommand,
  AgentCancelQueuedCommand,
  AgentInterruptCommand,
  AgentRespondCommand,
  AgentCloseCommand,
  AgentAttachmentGetCommand,
  AgentSetModelCommand,
  AgentDeleteSessionCommand,
  AgentHistoryGetCommand,
]);
export type TAgentCommand = S.Schema.Type<typeof AgentCommand>;
export type TAgentCommandType = TAgentCommand["type"];

// ---------------------------------------------------------------------------
// Events (daemon → consumer)
// ---------------------------------------------------------------------------

/** Fields every event may carry. */
const eventBase = {
  /** The session this event belongs to (absent only before one exists). */
  session_id: S.optional(AgentSessionId),
  /** Daemon-assigned ordinal, monotonically increasing per session. */
  seq: S.optional(S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0))),
  /** Epoch milliseconds on the daemon. */
  at: S.optional(S.Number.check(S.isGreaterThanOrEqualTo(0))),
  /** Echo of the {@link AgentCommand} `id` this event answers, if any. */
  command_id: S.optional(AgentCommandId),
} as const;

const TokenCount = S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0));

export const AgentTokenUsage = S.Struct({
  input_tokens: TokenCount,
  output_tokens: TokenCount,
  cached_input_tokens: S.optional(TokenCount),
  reasoning_tokens: S.optional(TokenCount),
  total_tokens: S.optional(TokenCount),
  /** The model's context window, when known, for a fill gauge. */
  context_window: S.optional(TokenCount),
});
export type TAgentTokenUsage = S.Schema.Type<typeof AgentTokenUsage>;

export const AgentSessionExitReason = S.Literals([
  "closed",
  "completed",
  "killed",
  "error",
]);
export type TAgentSessionExitReason = S.Schema.Type<
  typeof AgentSessionExitReason
>;

export const AgentSessionStartedEvent = S.Struct({
  ...eventBase,
  type: S.Literal("session.started"),
  session_id: AgentSessionId,
  engine: AgentEngine,
  model: S.optional(AgentModel),
  cwd: S.optional(AgentCwd),
  /** True when this is an attach/resume of an existing engine session. */
  resumed: S.optional(S.Boolean),
  skip_permissions: S.optional(S.Boolean),
});

/**
 * The engine began a new conversation in the same live TUI (for example,
 * Claude Code's `/new`). The consumer must discard the prior transcript; the
 * daemon also starts its replay buffer over so a later attach stays clean.
 */
export const AgentSessionResetEvent = S.Struct({
  ...eventBase,
  type: S.Literal("session.reset"),
});

/**
 * The session's configuration changed (today: its model), from whichever side
 * changed it (a web `set_model`, or `/model` typed in the terminal). Read from
 * the engine's own record, so every viewer converges on the same value.
 */
export const AgentSessionConfiguredEvent = S.Struct({
  ...eventBase,
  type: S.Literal("session.configured"),
  model: S.optional(AgentModel),
  /**
   * The conversation's title, from the engine's own record (Claude's
   * `ai-title`). Optional: older daemons omit it, older consumers ignore it.
   */
  title: S.optional(ShortText),
});

export const AgentSessionExitedEvent = S.Struct({
  ...eventBase,
  type: S.Literal("session.exited"),
  session_id: AgentSessionId,
  reason: AgentSessionExitReason,
  message: S.optional(ShortText),
});

export const AgentTurnStartedEvent = S.Struct({
  ...eventBase,
  type: S.Literal("turn.started"),
  turn_id: AgentRefId,
  model: S.optional(AgentModel),
  /**
   * The prompt text that opened the turn. Lets a consumer that attaches later
   * (replay) render the user's side of the transcript. Optional: older daemons
   * omit it and older consumers ignore it.
   */
  prompt: S.optional(S.String.check(S.isMaxLength(AGENT_MAX_PROMPT_LENGTH))),
  /**
   * Attachments saved for this turn (on-disk basename + mime + size). Optional:
   * terminal prompts and older daemons omit it; older consumers ignore it.
   */
  attachments: S.optional(
    S.Array(AgentAttachmentMeta).check(S.isMaxLength(AGENT_MAX_ATTACHMENTS)),
  ),
});

/** Most prompts a session holds behind its running turn. */
export const AGENT_MAX_QUEUED_PROMPTS = 16;

/**
 * The prompts waiting behind the running turn, oldest first — the whole
 * queue, so the latest event is the state. A `send` that lands mid-turn is
 * queued on the daemon and goes out as the turn ends (or on `send_now`).
 * Older consumers ignore it.
 */
export const AgentQueuedPrompt = S.Struct({
  /** Stable while the prompt is queued; used for a targeted cancel. */
  id: AgentRefId,
  /** Clipped preview, never the complete prompt. */
  prompt: ShortText,
  attachment_count: S.Number.check(
    S.isInt(),
    S.isGreaterThanOrEqualTo(0),
    S.isLessThanOrEqualTo(AGENT_MAX_ATTACHMENTS),
  ),
});
export type TAgentQueuedPrompt = S.Schema.Type<typeof AgentQueuedPrompt>;

export const AgentQueueUpdatedEvent = S.Struct({
  ...eventBase,
  type: S.Literal("queue.updated"),
  /**
   * Identified entries, oldest first. `string[]` remains valid on the browser
   * boundary for daemons predating this protocol shape.
   */
  prompts: S.Array(S.Union([AgentQueuedPrompt, ShortText])).check(
    S.isMaxLength(AGENT_MAX_QUEUED_PROMPTS),
  ),
  /** An interrupt pauses automatic draining until `resume_queue`. */
  held: S.optional(S.Boolean),
});

export const AgentTurnCompletedEvent = S.Struct({
  ...eventBase,
  type: S.Literal("turn.completed"),
  turn_id: AgentRefId,
  stop_reason: S.optional(S.String.check(S.isMaxLength(64))),
  /**
   * What the turn cost, from the engine's own record: `input_tokens` is the
   * context the turn's last request carried, `output_tokens` the sum the turn
   * generated. Optional: older daemons omit it, older consumers ignore it.
   */
  usage: S.optional(AgentTokenUsage),
});

export const AgentTurnAbortedEvent = S.Struct({
  ...eventBase,
  type: S.Literal("turn.aborted"),
  turn_id: AgentRefId,
  reason: S.Literals(["interrupted", "failed", "cancelled"]),
  message: S.optional(ShortText),
});

export const AgentToolStatus = S.Literals([
  "in_progress",
  "completed",
  "failed",
]);
export type TAgentToolStatus = S.Schema.Type<typeof AgentToolStatus>;

export const AgentNoticeKind = S.Literals([
  "compacted",
  "interrupted",
  "model_changed",
  "error",
  /** A background subagent reported completion (`ref_item_id` is its call). */
  "subagent_finished",
]);
export type TAgentNoticeKind = S.Schema.Type<typeof AgentNoticeKind>;

/** The renderable unit of a turn. */
export const AgentItem = S.Union([
  S.Struct({
    kind: S.Literal("assistant_message"),
    text: S.String,
  }),
  S.Struct({
    kind: S.Literal("reasoning"),
    text: S.String,
  }),
  S.Struct({
    kind: S.Literal("tool_call"),
    tool_name: S.String.check(
      S.isMinLength(1),
      S.isMaxLength(AGENT_TOOL_NAME_MAX_LENGTH),
    ),
    title: S.optional(ShortText),
    /** The tool's input as the engine reported it (JSON). */
    input: S.optional(S.Unknown),
    status: AgentToolStatus,
    /** Result text, truncated by the daemon to fit one line. */
    output: S.optional(S.String),
    is_error: S.optional(S.Boolean),
    /** The user (or a policy) refused the call; optional, additive. */
    denied: S.optional(S.Boolean),
    /** Wall time from call to result, when the engine recorded both. */
    duration_ms: S.optional(
      S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0)),
    ),
    /** A shell command's exit status, when the engine reported it. */
    exit_code: S.optional(S.Number.check(S.isInt())),
    /**
     * A subagent launched in the background: the call's own result is only
     * the launch ack, so it stays in progress past its turn until the
     * subagent finishes. Optional, additive.
     */
    background: S.optional(S.Boolean),
  }),
  /**
   * A marker in the conversation that is neither speech nor a tool: context
   * compacted, a turn interrupted, the model switched, an engine error. Older
   * consumers drop the whole event (unknown kind), which loses only the line.
   */
  S.Struct({
    kind: S.Literal("notice"),
    notice: AgentNoticeKind,
    text: S.optional(DetailText),
    /** The item the notice is about (a subagent's call). Optional, additive. */
    ref_item_id: S.optional(AgentRefId),
  }),
]);
export type TAgentItem = S.Schema.Type<typeof AgentItem>;

/** `item.updated` carries the item's full current state, not a diff. */
const itemEventFields = {
  ...eventBase,
  turn_id: S.optional(AgentRefId),
  item_id: AgentRefId,
  item: AgentItem,
  /**
   * The tool call (a Task / Agent subagent) this item belongs to: a
   * subagent's own text and tool calls nest under the call that spawned it.
   * Absent → a top-level item of the turn. Older consumers ignore it.
   */
  parent_item_id: S.optional(AgentRefId),
} as const;

export const AgentItemStartedEvent = S.Struct({
  ...itemEventFields,
  type: S.Literal("item.started"),
});
export const AgentItemUpdatedEvent = S.Struct({
  ...itemEventFields,
  type: S.Literal("item.updated"),
});
export const AgentItemCompletedEvent = S.Struct({
  ...itemEventFields,
  type: S.Literal("item.completed"),
});

export const AgentContentStream = S.Literals([
  "assistant_text",
  "reasoning_text",
  "tool_output",
]);
export type TAgentContentStream = S.Schema.Type<typeof AgentContentStream>;

export const AgentContentDeltaEvent = S.Struct({
  ...eventBase,
  type: S.Literal("content.delta"),
  turn_id: S.optional(AgentRefId),
  item_id: AgentRefId,
  stream: AgentContentStream,
  delta: S.String,
});

/** What an approval request asks permission for. */
export const AgentRequestKind = S.Literals([
  "command",
  "file_change",
  "tool",
  "other",
]);
export type TAgentRequestKind = S.Schema.Type<typeof AgentRequestKind>;

export const AgentRequestOpenedEvent = S.Struct({
  ...eventBase,
  type: S.Literal("request.opened"),
  request_id: AgentRefId,
  turn_id: S.optional(AgentRefId),
  item_id: S.optional(AgentRefId),
  request_kind: AgentRequestKind,
  title: S.optional(ShortText),
  detail: S.optional(DetailText),
  input: S.optional(S.Unknown),
});

export const AgentRequestResolvedEvent = S.Struct({
  ...eventBase,
  type: S.Literal("request.resolved"),
  request_id: AgentRefId,
  decision: AgentRequestDecision,
});

export const AgentUserInputQuestion = S.Struct({
  id: S.String.check(S.isMinLength(1), S.isMaxLength(128)),
  header: S.optional(ShortText),
  question: DetailText,
  options: S.optional(
    S.Array(
      S.Struct({
        label: ShortText,
        description: S.optional(S.String.check(S.isMaxLength(1024))),
      }),
    ).check(S.isMaxLength(64)),
  ),
  multi_select: S.optional(S.Boolean),
});
export type TAgentUserInputQuestion = S.Schema.Type<
  typeof AgentUserInputQuestion
>;

export const AgentUserInputRequestedEvent = S.Struct({
  ...eventBase,
  type: S.Literal("user-input.requested"),
  request_id: AgentRefId,
  turn_id: S.optional(AgentRefId),
  questions: S.Array(AgentUserInputQuestion).check(
    S.isMinLength(1),
    S.isMaxLength(16),
  ),
});

export const AgentUserInputResolvedEvent = S.Struct({
  ...eventBase,
  type: S.Literal("user-input.resolved"),
  request_id: AgentRefId,
  answers: AgentUserInputAnswers,
});

export const AgentTokenUsageUpdatedEvent = S.Struct({
  ...eventBase,
  type: S.Literal("thread.token-usage.updated"),
  usage: AgentTokenUsage,
});

export const AgentRuntimeWarningEvent = S.Struct({
  ...eventBase,
  type: S.Literal("runtime.warning"),
  code: S.optional(S.String.check(S.isMaxLength(64))),
  message: DetailText,
});

/**
 * `runtime.error` code of a `set_model` the engine accepted but could not
 * apply (the CLI refused the model, or never confirmed the switch).
 */
export const AGENT_MODEL_SWITCH_FAILED_CODE = "model_switch_failed";
/** `runtime.warning` code of a model switch the user declined. */
export const AGENT_MODEL_SWITCH_DECLINED_CODE = "model_switch_declined";

export const AgentRuntimeErrorEvent = S.Struct({
  ...eventBase,
  type: S.Literal("runtime.error"),
  code: S.optional(S.String.check(S.isMaxLength(64))),
  message: DetailText,
  /** True when the session cannot continue (a `session.exited` follows). */
  fatal: S.optional(S.Boolean),
});

/**
 * One chunk of an `attachment_get` response. Chunked so a single NDJSON line
 * stays under {@link AGENT_MAX_LINE_BYTES}: `data` is base64 of
 * `file[offset .. offset+decodedLen)`, and `done` is true on the last chunk.
 */
export const AgentAttachmentDataEvent = S.Struct({
  ...eventBase,
  type: S.Literal("attachment.data"),
  name: S.String.check(S.isMinLength(1), S.isMaxLength(256)),
  mime: S.String.check(S.isMinLength(1), S.isMaxLength(128)),
  /** Total decoded byte length of the file. */
  size: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0)),
  /** Decoded-byte offset of this chunk within the file. */
  offset: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0)),
  /** Base64 of this chunk. */
  data: S.String.check(S.isMaxLength(AGENT_MAX_ATTACHMENT_BASE64_LENGTH)),
  /** True when this is the last chunk. */
  done: S.Boolean,
});
export type TAgentAttachmentDataEvent = S.Schema.Type<
  typeof AgentAttachmentDataEvent
>;

/** Answer to `delete_session`: the session is gone from the device. */
export const AgentSessionDeletedEvent = S.Struct({
  ...eventBase,
  type: S.Literal("session.deleted"),
  session_id: AgentSessionId,
});

/**
 * A page of session history. On attach (no `events`): the cursor before the
 * replayed window. Answering `history_get` (same `command_id`): the older
 * events themselves, oldest first, each one {@link AgentEvent} line's value
 * (decode with {@link parseAgentEvent}; unknown types are dropped). Paging is
 * by whole turns, so a page never splits one. `has_more` false → the page
 * reaches the start of the session.
 */
export const AgentHistoryPageEvent = S.Struct({
  ...eventBase,
  type: S.Literal("history.page"),
  before_cursor: S.optional(AgentHistoryCursor),
  has_more: S.Boolean,
  events: S.optional(
    S.Array(S.Unknown).check(S.isMaxLength(AGENT_HISTORY_MAX_PAGE_EVENTS)),
  ),
});
export type TAgentHistoryPageEvent = S.Schema.Type<
  typeof AgentHistoryPageEvent
>;

/** One daemon → consumer event line. */
export const AgentEvent = S.Union([
  AgentSessionStartedEvent,
  AgentSessionResetEvent,
  AgentSessionConfiguredEvent,
  AgentSessionExitedEvent,
  AgentTurnStartedEvent,
  AgentQueueUpdatedEvent,
  AgentTurnCompletedEvent,
  AgentTurnAbortedEvent,
  AgentItemStartedEvent,
  AgentItemUpdatedEvent,
  AgentItemCompletedEvent,
  AgentContentDeltaEvent,
  AgentRequestOpenedEvent,
  AgentRequestResolvedEvent,
  AgentUserInputRequestedEvent,
  AgentUserInputResolvedEvent,
  AgentTokenUsageUpdatedEvent,
  AgentRuntimeWarningEvent,
  AgentRuntimeErrorEvent,
  AgentAttachmentDataEvent,
  AgentSessionDeletedEvent,
  AgentHistoryPageEvent,
]);
export type TAgentEvent = S.Schema.Type<typeof AgentEvent>;
export type TAgentEventType = TAgentEvent["type"];
/** Narrow {@link TAgentEvent} to one `type`. */
export type TAgentEventOf<K extends TAgentEventType> = Extract<
  TAgentEvent,
  { readonly type: K }
>;

// ---------------------------------------------------------------------------
// Parsing + NDJSON framing
// ---------------------------------------------------------------------------

const decodeCommand = S.decodeUnknownResult(S.revealCodec(AgentCommand));
const decodeEvent = S.decodeUnknownResult(S.revealCodec(AgentEvent));

/** Decode an already-parsed JSON value as a command, or null. */
export const parseAgentCommand = (value: unknown): TAgentCommand | null => {
  const result = decodeCommand(value);
  return Result.isSuccess(result) ? result.success : null;
};

/** Decode an already-parsed JSON value as an event, or null (unknown types too). */
export const parseAgentEvent = (value: unknown): TAgentEvent | null => {
  const result = decodeEvent(value);
  return Result.isSuccess(result) ? result.success : null;
};

const lineDecoder = new TextDecoder("utf-8", { fatal: true });
const NEWLINE = 0x0a;

/**
 * JSON-encode one value as a newline-terminated line. Null when it does not
 * serialize or exceeds {@link AGENT_MAX_LINE_BYTES} — the caller decides
 * (truncate, or emit a `runtime.warning`); a truncated line would desync the
 * framing.
 */
export const encodeAgentLine = (value: unknown): Uint8Array | null => {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    return null;
  }
  if (text === undefined) return null;
  const encoded = lineEncoder.encode(`${text}\n`);
  return encoded.byteLength > AGENT_MAX_LINE_BYTES ? null : encoded;
};

/** Decode one line's bytes (without `\n`) into JSON, or `undefined`. */
export const decodeAgentLine = (line: Uint8Array): unknown => {
  try {
    return JSON.parse(lineDecoder.decode(line));
  } catch {
    return undefined;
  }
};

export type TAgentLineSplitter = {
  /**
   * Feed one chunk; returns the complete lines it finished (without `\n`), or
   * null once a line exceeds `maxLineBytes` (the splitter stays failed).
   */
  readonly push: (chunk: Uint8Array) => readonly Uint8Array[] | null;
};

/**
 * Stateful NDJSON splitter. Partial lines are kept as a chunk list and joined
 * once, when their newline arrives, so a multi-megabyte line costs one copy
 * rather than one per DATA frame.
 */
export const createAgentLineSplitter = (
  maxLineBytes: number = AGENT_MAX_LINE_BYTES,
): TAgentLineSplitter => {
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let failed = false;
  const join = (tail: Uint8Array): Uint8Array => {
    if (pending.length === 0) return tail;
    const out = new Uint8Array(pendingBytes + tail.byteLength);
    let offset = 0;
    for (const part of pending) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    out.set(tail, offset);
    pending = [];
    pendingBytes = 0;
    return out;
  };
  return {
    push: (chunk) => {
      if (failed) return null;
      const lines: Uint8Array[] = [];
      let start = 0;
      for (let i = 0; i < chunk.byteLength; i += 1) {
        if (chunk[i] !== NEWLINE) continue;
        if (pendingBytes + (i - start) > maxLineBytes) {
          failed = true;
          return null;
        }
        lines.push(join(chunk.subarray(start, i)));
        start = i + 1;
      }
      if (start < chunk.byteLength) {
        const rest = chunk.subarray(start);
        if (pendingBytes + rest.byteLength > maxLineBytes) {
          failed = true;
          return null;
        }
        // Copy: the transport may reuse the chunk's buffer.
        pending.push(rest.slice());
        pendingBytes += rest.byteLength;
      }
      return lines;
    },
  };
};
