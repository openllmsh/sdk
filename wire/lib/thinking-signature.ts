/**
 * Recovery for a replayed Anthropic `thinking`/`redacted_thinking` block whose
 * `signature` the upstream rejects. Anthropic thinking signatures are bound to
 * the serving model (and account). A multi-turn fallback that hops
 * `claude_code` models (e.g. fable → opus → sonnet) replays a prior hop's
 * thinking into a hop that can't verify the signature → pre-stream HTTP 400:
 *   `messages.N.content.M: Invalid \`signature\` in \`thinking\` block`
 *
 * Anthropic's own model-switch guidance is to strip `thinking` and
 * `redacted_thinking` from prior assistant turns (blocks are model-tied).
 * Stripping and retrying the same hop once lets the model re-reason instead of
 * knocking out the entire claude_code arm of the chain — the Anthropic-wire
 * analog of {@link ./encrypted-content.ts}'s Responses `encrypted_content`
 * strip-retry (issue #420).
 *
 * ## Strip scope (cache + tool_use)
 *
 * - **Deterministic + minimal.** Only `thinking` / `redacted_thinking` content
 *   blocks are removed. Message order, system/tools/user content, and all other
 *   assistant blocks (`text`, `tool_use`, …) are left untouched so the stripped
 *   prefix is stable across same-model turns (Anthropic prompt-cache matches an
 *   exact per-model prefix).
 * - **Historical only by default.** Thinking on the *active tool-use
 *   continuation* assistant turn is PRESERVED: Anthropic requires the final
 *   assistant turn's thinking block when that turn carries `tool_use` and the
 *   next user turn answers with `tool_result`. Blindly stripping that block
 *   breaks the tool loop (`thinking`/`redacted_thinking` blocks in the latest
 *   assistant message cannot be modified / must round-trip).
 * - **Last resort: thinking off for this request.** If the preserved final-turn
 *   thinking itself carries a foreign-model signature (e.g. a Sonnet subagent
 *   fed an Opus-signed tool-use turn), keeping the block 400s on signature and
 *   stripping it alone 400s on tool-use integrity — but that integrity rule
 *   only applies while extended thinking is ON. {@link stripAllThinkingAndDisable}
 *   strips every thinking block AND removes the `thinking` param (plus the
 *   thinking-only `clear_thinking` context edits), which Anthropic accepts.
 *   Mirrors litellm's `strip_thinking_blocks_from_anthropic_messages_request_dict`.
 *   The model just doesn't think on that one turn; the next turn re-enables it.
 * - **Proactive strip only for OpenLLM-minted signatures.** A thinking block
 *   whose signature is an OpenLLM envelope (`openllm-rs1:` / `openllm-cn1:`,
 *   from a Muse / Codex / Grok turn) can never verify at Anthropic, so
 *   {@link sanitizeAnthropicReplay} drops it before sending. Genuine Anthropic
 *   signatures are never proactively stripped: only the TARGET model's
 *   acceptance decides, same-family signatures are often accepted, and
 *   stripping them would bust prompt cache on healthy multi-turn. Those go
 *   through the reactive 400 → strip → retry path.
 * - **No empty assistant turns.** An assistant message left with no content
 *   after a strip (a thinking-only turn) is dropped — Anthropic rejects empty
 *   content, and adjacent user turns are merged upstream.
 */

import { isOpenllmEnvelopeSignature } from "../adapters/messages/reasoning-signature";

/** Anthropic 400 body for an undecryptable / foreign-model thinking signature.
 *  Matches the documented phrasing and tolerates the `messages.N.content.M: `
 *  prefix Anthropic attaches; also accepts a bare `Invalid \`signature\` in
 *  \`thinking\` block` substring. */
const THINKING_SIGNATURE_FAILURE_RE =
  /Invalid\s*`signature`\s*in\s*`thinking`\s*block/i;

export const isThinkingSignatureError = (rawBody: string): boolean =>
  rawBody.length > 0 && THINKING_SIGNATURE_FAILURE_RE.test(rawBody);

const isThinkingBlock = (block: unknown): boolean => {
  if (block === null || typeof block !== "object") return false;
  const type = (block as { type?: unknown }).type;
  return type === "thinking" || type === "redacted_thinking";
};

const isToolUseBlock = (block: unknown): boolean =>
  block !== null &&
  typeof block === "object" &&
  (block as { type?: unknown }).type === "tool_use";

const isToolResultBlock = (block: unknown): boolean =>
  block !== null &&
  typeof block === "object" &&
  (block as { type?: unknown }).type === "tool_result";

const messageContent = (msg: unknown): unknown[] | null => {
  if (msg === null || typeof msg !== "object") return null;
  const content = (msg as { content?: unknown }).content;
  return Array.isArray(content) ? content : null;
};

const isAssistantWithThinking = (msg: unknown): boolean => {
  if (msg === null || typeof msg !== "object") return false;
  if ((msg as { role?: unknown }).role !== "assistant") return false;
  const content = messageContent(msg);
  return content !== null && content.some(isThinkingBlock);
};

/**
 * True when `messages[i]` is the pending tool-use continuation Anthropic
 * requires thinking to round-trip for. That pair must occupy the FINAL TWO
 * messages: `messages[len-2]` is an assistant turn carrying `tool_use` and
 * `messages[len-1]` is a user turn carrying `tool_result`. Only index
 * `len-2` is active — every earlier assistant-with-thinking (including a
 * completed tool loop that is merely the latest tool_use/tool_result pair
 * but is followed by more turns) is historical and safe to strip.
 */
const isActiveToolUseContinuation = (
  messages: ReadonlyArray<unknown>,
  index: number,
): boolean => {
  // Active only when this message is the penultimate one (final two messages).
  if (messages.length < 2 || index !== messages.length - 2) return false;

  const cur = messages[index];
  const next = messages[index + 1];
  if (cur === null || typeof cur !== "object") return false;
  if (next === null || typeof next !== "object") return false;
  if ((cur as { role?: unknown }).role !== "assistant") return false;
  if ((next as { role?: unknown }).role !== "user") return false;

  const curContent = messageContent(cur);
  const nextContent = messageContent(next);
  if (curContent === null || nextContent === null) return false;
  return curContent.some(isToolUseBlock) && nextContent.some(isToolResultBlock);
};

/** True when a built Anthropic Messages body carries at least one assistant
 *  `thinking`/`redacted_thinking` block that the strip transform would remove
 *  (i.e. not solely the preserved active tool-use continuation). A retry is
 *  only worth attempting when stripping would change the request. */
export const messagesBodyHasStrippableThinking = (body: unknown): boolean => {
  if (body === null || typeof body !== "object") return false;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return false;
  return messages.some(
    (msg, i) =>
      isAssistantWithThinking(msg) && !isActiveToolUseContinuation(messages, i),
  );
};

/** Remove the blocks `drop` selects from assistant messages, and drop any
 *  assistant message the removal leaves empty. `drop` sees the message's
 *  ORIGINAL index (before any message is removed). */
const stripAssistantBlocks = (
  messages: ReadonlyArray<unknown>,
  drop: (block: unknown, index: number) => boolean,
): unknown[] => {
  const out: unknown[] = [];
  messages.forEach((msg, i) => {
    const content = messageContent(msg);
    if (
      (msg as { role?: unknown } | null)?.role !== "assistant" ||
      content === null ||
      !content.some((block) => drop(block, i))
    ) {
      out.push(msg);
      return;
    }
    const kept = content.filter((block) => !drop(block, i));
    if (kept.length > 0) {
      out.push({ ...(msg as Record<string, unknown>), content: kept });
    }
  });
  return out;
};

const withMessages = (
  body: unknown,
  map: (messages: ReadonlyArray<unknown>) => unknown[],
): unknown => {
  if (body === null || typeof body !== "object") return body;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return body;
  return { ...(body as Record<string, unknown>), messages: map(messages) };
};

/** Return a copy of a built Anthropic Messages body with `thinking` and
 *  `redacted_thinking` blocks removed from every HISTORICAL assistant message.
 *  The active tool-use continuation assistant turn (tool_use answered by a
 *  trailing tool_result) is left intact — see file header. Other content
 *  blocks and non-assistant messages are untouched; order is preserved. */
export const stripMessagesThinkingBlocks = (body: unknown): unknown =>
  withMessages(body, (messages) =>
    stripAssistantBlocks(
      messages,
      (block, i) =>
        isThinkingBlock(block) && !isActiveToolUseContinuation(messages, i),
    ),
  );

const isForeignThinkingBlock = (block: unknown): boolean =>
  isThinkingBlock(block) &&
  isOpenllmEnvelopeSignature((block as { signature?: unknown }).signature);

export type TAnthropicReplaySanitized = {
  readonly body: unknown;
  /** The active tool-use turn's thinking was OpenLLM-minted, so extended
   *  thinking is off for this request. */
  readonly thinkingDisabled: boolean;
};

/**
 * Proactive, certain half of the recovery: drop every thinking block whose
 * signature OpenLLM minted (a Muse / Codex / Grok turn replayed into
 * Anthropic) BEFORE sending — Anthropic can never verify those, so this
 * costs no request and leaves Anthropic-signed history (and its cache)
 * alone. When the active tool-use turn's thinking is foreign, thinking is
 * turned off for this request (Anthropic requires that turn's thinking while
 * it is on). A cross-model Anthropic rejection still goes through the
 * reactive retry.
 */
export const sanitizeAnthropicReplay = (
  body: unknown,
): TAnthropicReplaySanitized => {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return { body, thinkingDisabled: false };
  const hasForeign = (msg: unknown): boolean =>
    (msg as { role?: unknown } | null)?.role === "assistant" &&
    (messageContent(msg)?.some(isForeignThinkingBlock) ?? false);
  if (!messages.some(hasForeign)) return { body, thinkingDisabled: false };
  const activeIndex = messages.length - 2;
  if (
    isActiveToolUseContinuation(messages, activeIndex) &&
    hasForeign(messages[activeIndex])
  ) {
    return { body: stripAllThinkingAndDisable(body), thinkingDisabled: true };
  }
  return {
    body: withMessages(body, (m) =>
      stripAssistantBlocks(m, isForeignThinkingBlock),
    ),
    thinkingDisabled: false,
  };
};

/** True when a built Anthropic Messages body carries ANY assistant
 *  `thinking`/`redacted_thinking` block (the active turn included). */
export const messagesBodyHasAnyThinking = (body: unknown): boolean => {
  const messages = (body as { messages?: unknown } | null)?.messages;
  return Array.isArray(messages) && messages.some(isAssistantWithThinking);
};

const isClearThinkingEdit = (edit: unknown): boolean =>
  edit !== null &&
  typeof edit === "object" &&
  String((edit as { type?: unknown }).type ?? "").startsWith("clear_thinking");

/** Last-resort recovery: strip thinking from EVERY assistant message (the
 *  active tool-use turn included) and turn extended thinking off for this
 *  request — without `thinking` enabled Anthropic no longer requires the
 *  final tool-use turn to carry its thinking. `clear_thinking_*` context
 *  edits are dropped too since they require thinking. See file header. */
export const stripAllThinkingAndDisable = (body: unknown): unknown => {
  if (body === null || typeof body !== "object") return body;
  const { thinking: _thinking, ...rest } = withMessages(body, (m) =>
    stripAssistantBlocks(m, isThinkingBlock),
  ) as Record<string, unknown>;
  const cm = rest.context_management;
  const edits = (cm as { edits?: unknown } | null)?.edits;
  if (!Array.isArray(edits) || !edits.some(isClearThinkingEdit)) return rest;
  const { context_management: _cm, ...withoutCm } = rest;
  const kept = edits.filter((e) => !isClearThinkingEdit(e));
  return kept.length > 0
    ? {
        ...withoutCm,
        context_management: { ...(cm as Record<string, unknown>), edits: kept },
      }
    : withoutCm;
};
