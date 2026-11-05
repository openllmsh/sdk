import { Schema as S } from "effect";
import { ModelCaps } from "./models";

// ─── OpenAI provider options ─────────────────────────────────────────────────

export const OpenAIProviderOptions = S.Struct({
  providerModelId: S.String,
});
export type TOpenAIProviderOptions = S.Schema.Type<
  typeof OpenAIProviderOptions
>;

export const OpenAIEndpointKind = S.Literals([
  "chat",
  "embeddings",
  "images",
  "videos",
  "audio_transcription",
  "audio_speech",
]);
export type TOpenAIEndpointKind = S.Schema.Type<typeof OpenAIEndpointKind>;

// ─── Anthropic tool shape (request side) ─────────────────────────────────────

export const AnthropicTool = S.Struct({
  name: S.String,
  description: S.optional(S.String),
  // `input_schema` is required for custom tools but optional for the
  // native server-side tools (`web_search_20250305`, `computer_20241022`,
  // `bash_20241022`, etc.) which Anthropic identifies by `type` instead.
  input_schema: S.optional(S.Unknown),
  type: S.optional(S.String),
  // A breakpoint on a tool makes the whole tool catalogue a cacheable
  // prefix — Claude Code marks the last tool. LiteLLM:
  // `llms/anthropic/chat/transformation.py` (~L783-799).
  cache_control: S.optional(
    S.NullOr(S.Struct({ type: S.Literal("ephemeral") })),
  ),
});
export type TAnthropicTool = S.Schema.Type<typeof AnthropicTool>;

// ─── Anthropic wire types — request ──────────────────────────────────────────

const AnthropicCacheControl = S.Struct({ type: S.Literal("ephemeral") });

const AnthropicTextBlock = S.Struct({
  type: S.Literal("text"),
  text: S.String,
  // Citation-bearing text blocks (returned when a document block has
  // `citations.enabled` and replayed verbatim as assistant history).
  // Kept opaque — the gateway never re-parses citations downstream, but
  // without this field the parsed-body re-serialize path (dispatch-chain
  // mutation branch) would silently strip them.
  citations: S.optional(S.Unknown),
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

const AnthropicImageSource = S.Union([
  S.Struct({
    type: S.Literal("base64"),
    media_type: S.String,
    data: S.String,
  }),
  S.Struct({ type: S.Literal("url"), url: S.String }),
  // Files API reference (beta `files-api-2025-04-14`).
  S.Struct({ type: S.Literal("file"), file_id: S.String }),
]);

const AnthropicImageBlock = S.Struct({
  type: S.Literal("image"),
  source: AnthropicImageSource,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

/** PDF / plain-text / custom-content document attachments. */
const AnthropicDocumentSource = S.Union([
  S.Struct({
    type: S.Literal("base64"),
    media_type: S.String,
    data: S.String,
  }),
  S.Struct({ type: S.Literal("url"), url: S.String }),
  S.Struct({
    type: S.Literal("text"),
    media_type: S.String,
    data: S.String,
  }),
  // Custom-content documents — kept opaque: the gateway never
  // re-parses the inner block list downstream.
  S.Struct({ type: S.Literal("content"), content: S.Unknown }),
  // Files API reference (beta `files-api-2025-04-14`).
  S.Struct({ type: S.Literal("file"), file_id: S.String }),
]);

const AnthropicDocumentBlock = S.Struct({
  type: S.Literal("document"),
  source: AnthropicDocumentSource,
  title: S.optional(S.NullOr(S.String)),
  context: S.optional(S.NullOr(S.String)),
  citations: S.optional(S.Struct({ enabled: S.Boolean })),
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});
export type TAnthropicDocumentBlock = S.Schema.Type<
  typeof AnthropicDocumentBlock
>;

/** RAG search-result blocks (citable sources supplied by the client). */
const AnthropicSearchResultBlock = S.Struct({
  type: S.Literal("search_result"),
  source: S.String,
  title: S.String,
  content: S.Array(AnthropicTextBlock),
  citations: S.optional(S.Unknown),
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});
export type TAnthropicSearchResultBlock = S.Schema.Type<
  typeof AnthropicSearchResultBlock
>;

/**
 * Tool-search reference to a tool definition the model may call. Declared
 * ahead of `AnthropicToolResultBlock` because it is one of the block types
 * a `tool_result` may legally carry.
 */
const AnthropicToolReferenceBlock = S.Struct({
  type: S.Literal("tool_reference"),
  tool_name: S.String,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

/** Code-execution container file reference (Files API upload). */
const AnthropicContainerUploadBlock = S.Struct({
  type: S.Literal("container_upload"),
  file_id: S.String,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

const AnthropicToolUseBlock = S.Struct({
  type: S.Literal("tool_use"),
  id: S.String,
  name: S.String,
  input: S.Unknown,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

const AnthropicToolResultBlock = S.Struct({
  type: S.Literal("tool_result"),
  tool_use_id: S.String,
  // A tool_result may carry image / document / search_result blocks
  // alongside text (e.g. a tool returning a screenshot or a retrieved
  // document) — all normal, documented Anthropic shapes.
  content: S.Union([
    S.String,
    S.Array(
      S.Union([
        AnthropicTextBlock,
        AnthropicImageBlock,
        AnthropicDocumentBlock,
        AnthropicSearchResultBlock,
        AnthropicToolReferenceBlock,
      ]),
    ),
  ]),
  is_error: S.optional(S.Boolean),
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

const AnthropicThinkingBlock = S.Struct({
  type: S.Literal("thinking"),
  thinking: S.String,
  signature: S.optional(S.String),
});

/** Server-side context compaction summary blocks (Anthropic streaming + JSON responses). */
const AnthropicCompactionBlock = S.Struct({
  type: S.Literal("compaction"),
  content: S.optional(S.Unknown),
});

// ── Assistant-history block types the gateway itself emits ──────────────────
// Clients (e.g. Claude Code) replay the previous assistant turn verbatim as
// history on the next request, so every block type we (or native Anthropic
// passthrough) put in a response must also decode on the way back in —
// otherwise the routing-time parse 400s the gateway's own output (#181).

/** Native server-side tool call returned by genuine Anthropic passthrough. */
const AnthropicServerToolUseBlock = S.Struct({
  type: S.Literal("server_tool_use"),
  id: S.String,
  name: S.String,
  input: S.Unknown,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

/** Result of a native server-side web search. `content` is the result
 * array or a `web_search_tool_result_error` object — kept opaque: the
 * gateway never re-parses it downstream. */
const AnthropicWebSearchToolResultBlock = S.Struct({
  type: S.Literal("web_search_tool_result"),
  tool_use_id: S.String,
  content: S.Unknown,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

/**
 * Result of a native server-side tool OTHER than web search. Each of these
 * is a block Anthropic RETURNS, which means an Anthropic-format client
 * replays it verbatim as assistant history on the next turn — so the
 * inbound decoder must accept every one or the gateway 400s its own
 * upstream's output (the `server_tool_use` regression, #181, again).
 *
 * `content` stays OPAQUE (`S.Unknown`) exactly like
 * `AnthropicWebSearchToolResultBlock`: the gateway never re-parses a
 * server-tool result, and the passthrough forwards the raw body, so
 * modelling the payload would buy nothing and could only go stale.
 */
const AnthropicWebFetchToolResultBlock = S.Struct({
  type: S.Literal("web_fetch_tool_result"),
  tool_use_id: S.String,
  content: S.Unknown,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

const AnthropicCodeExecutionToolResultBlock = S.Struct({
  type: S.Literal("code_execution_tool_result"),
  tool_use_id: S.String,
  content: S.Unknown,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

const AnthropicBashCodeExecutionToolResultBlock = S.Struct({
  type: S.Literal("bash_code_execution_tool_result"),
  tool_use_id: S.String,
  content: S.Unknown,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

const AnthropicTextEditorCodeExecutionToolResultBlock = S.Struct({
  type: S.Literal("text_editor_code_execution_tool_result"),
  tool_use_id: S.String,
  content: S.Unknown,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

const AnthropicToolSearchToolResultBlock = S.Struct({
  type: S.Literal("tool_search_tool_result"),
  tool_use_id: S.String,
  content: S.Unknown,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

const AnthropicMcpToolResultBlock = S.Struct({
  type: S.Literal("mcp_tool_result"),
  tool_use_id: S.String,
  content: S.Unknown,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

/** MCP-connector tool invocation (beta). Shaped like `tool_use` + a server name. */
const AnthropicMcpToolUseBlock = S.Struct({
  type: S.Literal("mcp_tool_use"),
  id: S.String,
  name: S.String,
  server_name: S.optional(S.String),
  input: S.Unknown,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

/** Browser tab/state snapshot emitted by the browser-use server tool. */
const AnthropicBrowserStateBlock = S.Struct({
  type: S.Literal("browser_state"),
  content: S.optional(S.Unknown),
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

/**
 * A tool definition added mid-conversation (`inline-tools-2026-09-15` beta):
 * Claude Code sends one per newly-available tool (e.g. an MCP server that
 * connected late) inside a `role: "system"` turn. `tool` stays opaque — the
 * passthrough forwards the raw body; nothing downstream re-parses it.
 */
const AnthropicToolAdditionBlock = S.Struct({
  type: S.Literal("tool_addition"),
  tool: S.Unknown,
  cache_control: S.optional(S.NullOr(AnthropicCacheControl)),
});

/** Encrypted thinking returned by native Anthropic passthrough. */
const AnthropicRedactedThinkingBlock = S.Struct({
  type: S.Literal("redacted_thinking"),
  data: S.String,
});

export const AnthropicContentBlock = S.Union([
  AnthropicTextBlock,
  AnthropicImageBlock,
  AnthropicDocumentBlock,
  AnthropicSearchResultBlock,
  AnthropicContainerUploadBlock,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
  AnthropicThinkingBlock,
  AnthropicCompactionBlock,
  AnthropicServerToolUseBlock,
  AnthropicWebSearchToolResultBlock,
  AnthropicWebFetchToolResultBlock,
  AnthropicCodeExecutionToolResultBlock,
  AnthropicBashCodeExecutionToolResultBlock,
  AnthropicTextEditorCodeExecutionToolResultBlock,
  AnthropicToolSearchToolResultBlock,
  AnthropicMcpToolUseBlock,
  AnthropicMcpToolResultBlock,
  AnthropicToolReferenceBlock,
  AnthropicBrowserStateBlock,
  AnthropicToolAdditionBlock,
  AnthropicRedactedThinkingBlock,
]);
export type TAnthropicContentBlock = S.Schema.Type<
  typeof AnthropicContentBlock
>;

export const AnthropicMessage = S.Struct({
  // `system` joins `user`/`assistant` as of the Claude 4.8-era clients
  // (Claude Code v2.1.157+), which inline a system turn in `messages[]`
  // when the `mid-conversation-system-2026-04-07` beta is active —
  // exactly the beta we started forwarding correctly in PR #12. Anthropic
  // ACCEPTS that shape under the beta, so the routing-time parse must
  // accept it too or `/v1/messages` 400s before we can forward.
  //   - Passthrough (anthropic / claude_code first hop): the raw body
  //     is forwarded verbatim with the beta header, and Anthropic
  //     honours the inline system turn — this literal just stops our
  //     own parse from rejecting it.
  //   - Cross-provider fallback hop: `splitAnthropicMessage` in
  //     `adapters/messages/request.ts` maps the inline system turn to
  //     the canonical `system` role for the non-Anthropic upstream.
  role: S.Literals(["user", "assistant", "system"]),
  content: S.Union([S.String, S.Array(AnthropicContentBlock)]),
});
export type TAnthropicMessage = S.Schema.Type<typeof AnthropicMessage>;

const AnthropicSystemBlock = S.Union([S.String, S.Array(AnthropicTextBlock)]);

// `disable_parallel_tool_use` is documented on auto / any / tool (never on
// `none`). Modelled rather than merely tolerated because it is the one
// tool_choice field with a canonical counterpart — OpenAI's
// `parallel_tool_calls` — so the adapters map it in both directions
// instead of silently discarding the client's intent on a cross-wire hop.
const AnthropicToolChoice = S.Union([
  S.Struct({
    type: S.Literal("auto"),
    disable_parallel_tool_use: S.optional(S.Boolean),
  }),
  S.Struct({
    type: S.Literal("any"),
    disable_parallel_tool_use: S.optional(S.Boolean),
  }),
  S.Struct({
    type: S.Literal("tool"),
    name: S.String,
    disable_parallel_tool_use: S.optional(S.Boolean),
  }),
  S.Struct({ type: S.Literal("none") }),
]);

/**
 * Extended-thinking knob. `enabled` carries an explicit budget;
 * `adaptive` lets Claude 4.6+ decide the budget itself (paired with
 * `output_config.effort` to set the target effort level).
 */
export const AnthropicThinking = S.Union([
  S.Struct({
    type: S.Literal("enabled"),
    budget_tokens: S.Number,
  }),
  S.Struct({ type: S.Literal("adaptive") }),
  // `disabled` is accepted by every model that is not "always on"
  // (Opus 4.8 / Opus 5 / Sonnet 5 / the 4.6 and 4.5 generations). Omitting
  // it from this union did not make the gateway lenient — it made the
  // gateway 400 a supported configuration before dispatch, on both the
  // cloud handler and the daemon listener.
  S.Struct({ type: S.Literal("disabled") }),
]);
export type TAnthropicThinking = S.Schema.Type<typeof AnthropicThinking>;

/**
 * Adaptive-thinking effort levels Anthropic accepts on
 * `output_config.effort`. Only honoured by Claude 4.6+; other models
 * 400 if this is set (see `providers/anthropic/adaptive-thinking.ts`).
 */
export const AnthropicEffort = S.Literals([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type TAnthropicEffort = S.Schema.Type<typeof AnthropicEffort>;

export const AnthropicOutputConfig = S.Struct({
  effort: S.optional(AnthropicEffort),
});
export type TAnthropicOutputConfig = S.Schema.Type<
  typeof AnthropicOutputConfig
>;

export const AnthropicRequest = S.Struct({
  model: S.String,
  messages: S.Array(AnthropicMessage),
  max_tokens: S.Number,
  system: S.optional(AnthropicSystemBlock),
  temperature: S.optional(S.Number),
  top_p: S.optional(S.Number),
  top_k: S.optional(S.Number),
  stop_sequences: S.optional(S.Array(S.String)),
  stream: S.optional(S.Boolean),
  tools: S.optional(S.Array(AnthropicTool)),
  tool_choice: S.optional(AnthropicToolChoice),
  metadata: S.optional(S.Struct({ user_id: S.optional(S.String) })),
  thinking: S.optional(AnthropicThinking),
  output_config: S.optional(AnthropicOutputConfig),
});
export type TAnthropicRequest = S.Schema.Type<typeof AnthropicRequest>;

/**
 * `POST /v1/messages/count_tokens` — the Messages request with `max_tokens`
 * OPTIONAL. The count endpoint has no output budget, so a real Claude Code
 * preflight omits it; validating those bodies against `AnthropicRequest` would
 * 400 every one of them.
 */
export const AnthropicCountTokensRequest = S.Struct({
  ...AnthropicRequest.fields,
  max_tokens: S.optional(S.Number),
});
export type TAnthropicCountTokensRequest = S.Schema.Type<
  typeof AnthropicCountTokensRequest
>;

// ─── Anthropic wire types — response ─────────────────────────────────────────

export const AnthropicStopReason = S.Literals([
  "end_turn",
  "max_tokens",
  "stop_sequence",
  "tool_use",
  "pause_turn",
  "refusal",
  // The response filled the model's context window. Absent from this
  // union, the terminal `message_delta` carrying it failed decode and was
  // DROPPED by `decodeProviderEventStream` — taking the finish reason and
  // the whole usage trailer with it, so a cross-wire stream ended with no
  // stop reason and zero tokens.
  "model_context_window_exceeded",
]);
export type TAnthropicStopReason = S.Schema.Type<typeof AnthropicStopReason>;

/** Server-tool activity counters. Clients (Claude Code's WebSearch) read
 *  `web_search_requests` to count searches — set both by genuine Anthropic
 *  passthrough and by the gateway's cross-wire re-encode of provider-hosted
 *  search (`server_search_calls`). ONE definition shared by the response
 *  usage and the terminal `message_delta` usage so the two can't drift. */
const AnthropicServerToolUseUsage = S.Struct({
  web_search_requests: S.optional(S.Number),
});

export const AnthropicUsage = S.Struct({
  input_tokens: S.Number,
  output_tokens: S.Number,
  cache_creation_input_tokens: S.optional(S.NullOr(S.Number)),
  cache_read_input_tokens: S.optional(S.NullOr(S.Number)),
  server_tool_use: S.optional(S.NullOr(AnthropicServerToolUseUsage)),
});
export type TAnthropicUsage = S.Schema.Type<typeof AnthropicUsage>;

export const AnthropicResponse = S.Struct({
  id: S.String,
  type: S.Literal("message"),
  role: S.Literal("assistant"),
  model: S.String,
  content: S.Array(AnthropicContentBlock),
  stop_reason: S.NullOr(AnthropicStopReason),
  stop_sequence: S.NullOr(S.String),
  usage: AnthropicUsage,
});
export type TAnthropicResponse = S.Schema.Type<typeof AnthropicResponse>;

// ─── Anthropic wire types — streaming events ─────────────────────────────────

const AnthropicMessageStartEvent = S.Struct({
  type: S.Literal("message_start"),
  message: S.Struct({
    id: S.String,
    type: S.Literal("message"),
    role: S.Literal("assistant"),
    model: S.String,
    content: S.Array(AnthropicContentBlock),
    stop_reason: S.NullOr(AnthropicStopReason),
    stop_sequence: S.NullOr(S.String),
    usage: AnthropicUsage,
  }),
});

const AnthropicContentBlockStartEvent = S.Struct({
  type: S.Literal("content_block_start"),
  index: S.Number,
  content_block: AnthropicContentBlock,
});

const AnthropicTextDelta = S.Struct({
  type: S.Literal("text_delta"),
  text: S.String,
});

const AnthropicInputJsonDelta = S.Struct({
  type: S.Literal("input_json_delta"),
  partial_json: S.String,
});

const AnthropicThinkingDelta = S.Struct({
  type: S.Literal("thinking_delta"),
  thinking: S.String,
});

const AnthropicSignatureDelta = S.Struct({
  type: S.Literal("signature_delta"),
  signature: S.String,
});

const AnthropicCompactionDelta = S.Struct({
  type: S.Literal("compaction_delta"),
  content: S.optional(S.Unknown),
});

/** Streamed citation attachment for a text block (document citations
 * enabled) — kept opaque; only decoded (non-passthrough) streams see it. */
const AnthropicCitationsDelta = S.Struct({
  type: S.Literal("citations_delta"),
  citation: S.Unknown,
});

const AnthropicContentBlockDeltaEvent = S.Struct({
  type: S.Literal("content_block_delta"),
  index: S.Number,
  delta: S.Union([
    AnthropicTextDelta,
    AnthropicInputJsonDelta,
    AnthropicThinkingDelta,
    AnthropicSignatureDelta,
    AnthropicCompactionDelta,
    AnthropicCitationsDelta,
  ]),
});

const AnthropicContentBlockStopEvent = S.Struct({
  type: S.Literal("content_block_stop"),
  index: S.Number,
});

const AnthropicMessageDeltaEvent = S.Struct({
  type: S.Literal("message_delta"),
  delta: S.Struct({
    stop_reason: S.NullOr(AnthropicStopReason),
    stop_sequence: S.NullOr(S.String),
  }),
  usage: S.Struct({
    output_tokens: S.Number,
    input_tokens: S.optional(S.NullOr(S.Number)),
    cache_creation_input_tokens: S.optional(S.NullOr(S.Number)),
    cache_read_input_tokens: S.optional(S.NullOr(S.Number)),
    /** Server-tool counters on the terminal delta (mirrors `AnthropicUsage`). */
    server_tool_use: S.optional(S.NullOr(AnthropicServerToolUseUsage)),
  }),
});

const AnthropicMessageStopEvent = S.Struct({
  type: S.Literal("message_stop"),
});

const AnthropicPingEvent = S.Struct({ type: S.Literal("ping") });

const AnthropicErrorEvent = S.Struct({
  type: S.Literal("error"),
  error: S.Struct({ type: S.String, message: S.String }),
});

export const AnthropicStreamEvent = S.Union([
  AnthropicMessageStartEvent,
  AnthropicContentBlockStartEvent,
  AnthropicContentBlockDeltaEvent,
  AnthropicContentBlockStopEvent,
  AnthropicMessageDeltaEvent,
  AnthropicMessageStopEvent,
  AnthropicPingEvent,
  AnthropicErrorEvent,
]);
export type TAnthropicStreamEvent = S.Schema.Type<typeof AnthropicStreamEvent>;

// ─── Anthropic provider options ──────────────────────────────────────────────

export const AnthropicProviderOptions = S.Struct({
  providerModelId: S.String,
  apiVersion: S.optional(S.String),
  defaultMaxTokens: S.optional(S.Number),
  /**
   * The resolved model card's caps. Carries `thinkingModes`, which is how
   * the encoder learns which thinking mode this model accepts WITHOUT the
   * wire package knowing any model names. Absent = unknown = permissive.
   */
  caps: S.optional(ModelCaps),
});
export type TAnthropicProviderOptions = S.Schema.Type<
  typeof AnthropicProviderOptions
>;

// ─── Google AI Studio — image generation (Nano Banana / Imagen) ──────────────

// generativelanguage.googleapis.com/v1beta returns image bytes inline.
const GoogleImageInlineData = S.Struct({
  mime_type: S.optional(S.String),
  mimeType: S.optional(S.String),
  data: S.String,
});

const GoogleImagePart = S.Union([
  S.Struct({ text: S.String }),
  S.Struct({ inlineData: GoogleImageInlineData }),
]);

const GoogleImageCandidate = S.Struct({
  content: S.optional(
    S.Struct({
      parts: S.optional(S.Array(GoogleImagePart)),
      role: S.optional(S.String),
    }),
  ),
  finishReason: S.optional(S.NullOr(S.String)),
});

export const GoogleImageRequest = S.Struct({
  contents: S.Array(
    S.Struct({
      parts: S.Array(S.Struct({ text: S.String })),
    }),
  ),
  generationConfig: S.Struct({
    response_modalities: S.Array(S.String),
    // Gemini's generateContent nests aspect ratio under `imageConfig`;
    // there is no `sampleCount` (it returns one image per call). Sending
    // `sampleCount`/`aspectRatio` at the generationConfig top level 400s
    // with "Unknown name ... at 'generation_config'".
    imageConfig: S.optional(
      S.Struct({
        aspectRatio: S.optional(S.String),
      }),
    ),
  }),
});
export type TGoogleImageRequest = S.Schema.Type<typeof GoogleImageRequest>;

const GoogleImageUsageMetadata = S.Struct({
  promptTokenCount: S.optional(S.NullOr(S.Number)),
  candidatesTokenCount: S.optional(S.NullOr(S.Number)),
  totalTokenCount: S.optional(S.NullOr(S.Number)),
  cachedContentTokenCount: S.optional(S.NullOr(S.Number)),
});

export const GoogleImageResponse = S.Struct({
  candidates: S.optional(S.Array(GoogleImageCandidate)),
  usageMetadata: S.optional(GoogleImageUsageMetadata),
});
export type TGoogleImageResponse = S.Schema.Type<typeof GoogleImageResponse>;

export const GoogleImageProviderOptions = S.Struct({
  providerModelId: S.String,
  /**
   * Catalog-resolved facts for THIS model. Absent means unknown, and an
   * unknown limit never manufactures a refusal.
   */
  caps: S.optional(ModelCaps),
});
export type TGoogleImageProviderOptions = S.Schema.Type<
  typeof GoogleImageProviderOptions
>;

// ─── OpenAI — video generation (Sora, async job surface) ─────────────────────

// The upstream video job object returned by POST /v1/videos and
// GET /v1/videos/{id}. Kept lenient — `status` stays a plain string so
// an unrecognized upstream state degrades to `in_progress` in the
// provider's fromBody instead of failing schema decode.
export const OpenAIVideoJob = S.Struct({
  id: S.String,
  status: S.String,
  created_at: S.optional(S.Number),
  progress: S.optional(S.NullOr(S.Number)),
  seconds: S.optional(S.Union([S.String, S.Number])),
  size: S.optional(S.String),
  error: S.optional(
    S.NullOr(
      S.Struct({
        code: S.optional(S.String),
        message: S.optional(S.String),
      }),
    ),
  ),
});
export type TOpenAIVideoJob = S.Schema.Type<typeof OpenAIVideoJob>;

export const OpenAIVideoProviderOptions = S.Struct({
  providerModelId: S.String,
});
export type TOpenAIVideoProviderOptions = S.Schema.Type<
  typeof OpenAIVideoProviderOptions
>;

// ─── Google AI Studio — video generation (Veo, predictLongRunning) ──────────

/**
 * Veo's `predictLongRunning` image shape on the Gemini DEVELOPER API.
 *
 * Source of truth is Google's own client, not the REST snippets in the
 * Veo guide (which show `inlineData` and are contradicted by the live
 * surface — it answers 400 INVALID_ARGUMENT "`inlineData` isn't
 * supported by this model"). `googleapis/python-genai` v2.24.0,
 * `google/genai/models.py::_Image_to_mldev`, serializes
 * `Image.image_bytes` → `bytesBase64Encoded` and `Image.mime_type` →
 * `mimeType` for Developer-API mode (`gcs_uri` raises there), and
 * `_GenerateVideosParameters_to_mldev` places that object at
 * `instances[0].image`, with `_VideoGenerationReferenceImage_to_mldev`
 * reusing it for `instances[0].referenceImages[].image`.
 */
export const GoogleVideoImage = S.Struct({
  bytesBase64Encoded: S.String,
  mimeType: S.String,
});
export type TGoogleVideoImage = S.Schema.Type<typeof GoogleVideoImage>;

export const GoogleVideoCreateRequest = S.Struct({
  instances: S.Array(
    S.Struct({
      prompt: S.String,
      image: S.optional(GoogleVideoImage),
      referenceImages: S.optional(
        S.Array(
          S.Struct({
            image: GoogleVideoImage,
            referenceType: S.Literal("asset"),
          }),
        ),
      ),
    }),
  ),
  parameters: S.Struct({
    aspectRatio: S.optional(S.String),
    resolution: S.optional(S.String),
    durationSeconds: S.optional(S.Number),
  }),
});
export type TGoogleVideoCreateRequest = S.Schema.Type<
  typeof GoogleVideoCreateRequest
>;

// predictLongRunning returns a bare long-running-operation handle.
export const GoogleVideoOperationRef = S.Struct({
  name: S.String,
});
export type TGoogleVideoOperationRef = S.Schema.Type<
  typeof GoogleVideoOperationRef
>;

// GET /v1beta/{operation.name} — the poll envelope. `response` is left
// opaque; the provider extracts the generated video URI with a typed
// walker (`generateVideoResponse.generatedSamples[0].video.uri`, with a
// `generatedVideos` fallback some Veo revisions use).
export const GoogleVideoOperation = S.Struct({
  name: S.optional(S.String),
  done: S.optional(S.Boolean),
  error: S.optional(
    S.Struct({
      code: S.optional(S.Number),
      message: S.optional(S.String),
    }),
  ),
  response: S.optional(S.Unknown),
});
export type TGoogleVideoOperation = S.Schema.Type<typeof GoogleVideoOperation>;

export const GoogleVideoProviderOptions = S.Struct({
  providerModelId: S.String,
  /**
   * Catalog-resolved facts for THIS model (accepted durations, ratios,
   * resolutions, reference limits). Absent means unknown, and an
   * unknown limit never manufactures a refusal.
   */
  caps: S.optional(ModelCaps),
});
export type TGoogleVideoProviderOptions = S.Schema.Type<
  typeof GoogleVideoProviderOptions
>;

// ─── Bedrock — Amazon Titan v2 embeddings ────────────────────────────────────

export const BedrockTitanV2Request = S.Struct({
  inputText: S.String,
  dimensions: S.optional(S.Number),
  normalize: S.optional(S.Boolean),
  embeddingTypes: S.optional(S.Array(S.Literals(["float", "binary"]))),
});
export type TBedrockTitanV2Request = S.Schema.Type<
  typeof BedrockTitanV2Request
>;

const BedrockTitanV2EmbeddingsByType = S.Struct({
  float: S.optional(S.Array(S.Number)),
  binary: S.optional(S.Array(S.Number)),
});

export const BedrockTitanV2Response = S.Struct({
  embedding: S.optional(S.Array(S.Number)),
  embeddingsByType: S.optional(BedrockTitanV2EmbeddingsByType),
  inputTextTokenCount: S.Number,
});
export type TBedrockTitanV2Response = S.Schema.Type<
  typeof BedrockTitanV2Response
>;

export const BedrockEmbedProviderOptions = S.Struct({
  providerModelId: S.String,
  region: S.String,
  accessKeyId: S.String,
  secretAccessKey: S.String,
  sessionToken: S.optional(S.String),
  dimensions: S.optional(S.Number),
  normalize: S.optional(S.Boolean),
});
export type TBedrockEmbedProviderOptions = S.Schema.Type<
  typeof BedrockEmbedProviderOptions
>;

// ─── ChatGPT (Codex / Responses) provider options ────────────────────────────

/**
 * Options for the `chatgpt` provider — chatgpt.com/backend-api/codex.
 *
 * `accountId` / `sessionId` ride in outbound headers per the Codex CLI
 * convention; both are pulled from the decrypted OAuth blob's `extras`.
 * `originator` and `userAgent` are server-tunable via environment
 * variables; defaults match the reference Python implementation.
 */
export const ChatGptProviderOptions = S.Struct({
  providerModelId: S.String,
  accountId: S.optional(S.String),
  sessionId: S.optional(S.String),
  originator: S.optional(S.String),
  userAgent: S.optional(S.String),
  /**
   * Select Codex-specific Responses-wire behavior. When `false` for a
   * non-Codex provider that shares the wire (xAI Grok),
   * `max_output_tokens` is forwarded; ChatGPT/Codex rejects that field.
   * System messages always become `developer` input items and never alter
   * top-level `instructions`, regardless of this flag. Defaults to TRUE when
   * omitted; the daemon walker passes `false` for non-`chatgpt`
   * Responses-wire providers.
   */
  codexInstructions: S.optional(S.Boolean),
  /**
   * The resolved model card's caps. Carries `reasoningContexts`, which is how
   * the encoder learns that a model rejects `reasoning.context: "all_turns"`
   * — a fact it used to derive from a `spark` suffix on the model id. Absent
   * = unknown = permissive.
   */
  caps: S.optional(ModelCaps),
});
export type TChatGptProviderOptions = S.Schema.Type<
  typeof ChatGptProviderOptions
>;

// ─── Kimi Code provider options ──────────────────────────────────────────────
//
// Identity fields are populated by the LOCAL DAEMON from the official
// Kimi CLI's own headers (User-Agent + X-Msh-*), so upstream calls carry
// the real client identity rather than a synthesized one. All optional —
// absent on any non-daemon caller, in which case `kimiCodeAuthHeaders`
// sends only auth + content headers (no fabricated X-Msh-* device fields).
export const KimiCodeProviderOptions = S.Struct({
  providerModelId: S.String,
  userAgent: S.optional(S.String),
  platform: S.optional(S.String),
  version: S.optional(S.String),
  deviceId: S.optional(S.String),
  deviceName: S.optional(S.String),
  deviceModel: S.optional(S.String),
  osVersion: S.optional(S.String),
});
export type TKimiCodeProviderOptions = S.Schema.Type<
  typeof KimiCodeProviderOptions
>;

// (ChatGPT device-code OAuth wire types removed — subscription sign-in is
// the official Codex CLI's job, delegated by the local daemon; the gateway
// no longer runs any OAuth/device-code/token-exchange flow.)
