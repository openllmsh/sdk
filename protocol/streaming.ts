import { Schema as S } from "effect";

export const SseEvent = S.Union([
  S.Struct({ kind: S.Literal("data"), data: S.String }),
  S.Struct({ kind: S.Literal("done") }),
  S.Struct({ kind: S.Literal("comment"), comment: S.String }),
]);
export type TSseEvent = S.Schema.Type<typeof SseEvent>;

export const HeartbeatOptions = S.Struct({
  intervalMs: S.Number,
  // Which keepalive frame to emit while the upstream is silent.
  //  - "comment"        → `: keepalive\n\n` (OpenAI-idiomatic; safe to
  //    lead with — used on the `/v1/chat/completions` surface).
  //  - "anthropic_ping" → `event: ping\ndata: {"type":"ping"}\n\n`
  //    (what Claude Code's Anthropic SDK expects on `/v1/messages`).
  kind: S.optional(S.Literals(["comment", "anthropic_ping"])),
});
export type THeartbeatOptions = S.Schema.Type<typeof HeartbeatOptions>;
