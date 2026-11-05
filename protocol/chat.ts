import { Schema as S } from "effect";

/**
 * OpenAI-compatible reasoning effort. Shared by chat `reasoning_effort`
 * and Responses `reasoning.effort` so Codex values like `xhigh` decode
 * on both inbound surfaces. Downstream providers may still clamp.
 */
export const ReasoningEffort = S.Literals([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "none",
]);
export type TReasoningEffort = S.Schema.Type<typeof ReasoningEffort>;

const FunctionCall = S.Struct({
  name: S.String,
  arguments: S.String,
});

const ToolCall = S.Struct({
  id: S.String,
  type: S.Literals(["function"]),
  function: FunctionCall,
});
export type TToolCall = S.Schema.Type<typeof ToolCall>;

/**
 * Prompt-cache breakpoint. OpenAI-format clients (and LiteLLM's
 * `ChatCompletionCachedContent`) mark a content block / message / tool
 * with `cache_control: {type:"ephemeral"}` to make everything up to and
 * including it a cacheable prefix on the Anthropic wire. Dropping it
 * silently disables prompt caching → ~10x token cost on agent loops.
 */
const CacheControl = S.Struct({ type: S.Literals(["ephemeral"]) });
export type TCacheControl = S.Schema.Type<typeof CacheControl>;

const TextPart = S.Struct({
  type: S.Literals(["text"]),
  text: S.String,
  cache_control: S.optional(S.NullOr(CacheControl)),
});

const ImageUrlPart = S.Struct({
  type: S.Literals(["image_url"]),
  image_url: S.Struct({
    url: S.String,
    detail: S.optional(S.Literals(["auto", "low", "high"])),
  }),
  cache_control: S.optional(S.NullOr(CacheControl)),
});

const InputAudioPart = S.Struct({
  type: S.Literals(["input_audio"]),
  input_audio: S.Struct({
    data: S.String,
    format: S.Literals(["wav", "mp3"]),
  }),
});

/**
 * OpenAI-native file attachment (PDFs etc.). `file_data` is a data URL
 * (`data:<mime>;base64,<b64>`); `file_id` references a provider-side
 * uploaded file. `url` is a public file URL and is treated as a clean-context
 * document carrier (no bytes are placed on the request body).
 * The canonical carrier for Anthropic `document` blocks on
 * cross-provider hops.
 */
const FilePart = S.Struct({
  type: S.Literals(["file"]),
  file: S.Struct({
    file_data: S.optional(S.String),
    file_id: S.optional(S.String),
    filename: S.optional(S.String),
    url: S.optional(S.String),
  }),
  cache_control: S.optional(S.NullOr(CacheControl)),
});
export type TFilePart = S.Schema.Type<typeof FilePart>;

const ContentPart = S.Union([TextPart, ImageUrlPart, InputAudioPart, FilePart]);

const MessageContent = S.Union([S.String, S.Array(ContentPart)]);

const SystemMessage = S.Struct({
  role: S.Literals(["system"]),
  content: MessageContent,
  name: S.optional(S.String),
  cache_control: S.optional(S.NullOr(CacheControl)),
});

const UserMessage = S.Struct({
  role: S.Literals(["user"]),
  content: MessageContent,
  name: S.optional(S.String),
  cache_control: S.optional(S.NullOr(CacheControl)),
});

/**
 * One PROVIDER-executed (hosted/server-side) web search that ran inside the
 * upstream turn — e.g. Codex hosted `web_search` on a chatgpt native hop.
 * Canonical and wire-neutral: client wires re-encode it (Anthropic →
 * `server_tool_use` + `web_search_tool_result` blocks and
 * `usage.server_tool_use.web_search_requests`). The gateway never executes
 * anything to produce one of these — it only REPORTS what the provider did;
 * result contents stay provider-internal (only the queries are visible).
 */
export const ServerSearchCall = S.Struct({
  /** Provider item id (e.g. Codex `ws_…`) — becomes the block id. */
  id: S.String,
  /** The primary query the provider searched. */
  query: S.String,
  /** Fan-out queries when the provider reports them (Codex `action.queries`). */
  queries: S.optional(S.Array(S.String)),
  /** Source links when the provider reports them (grok `action.sources`) —
   *  re-encoded as the search block's result items so clients get real URLs. */
  results: S.optional(
    S.Array(S.Struct({ url: S.String, title: S.optional(S.String) })),
  ),
});
export type TServerSearchCall = S.Schema.Type<typeof ServerSearchCall>;

/**
 * Response-only assistant fields the decoder used to discard: `annotations`
 * (web-search URL citations) and `audio` (the audio output object, or on a
 * replayed turn the `{id}` reference to it).
 *
 * Typed as `S.Unknown` ON PURPOSE. Modelling their exact shapes would make the
 * decoder STRICTER than the baseline it replaces: today an unknown value in
 * either field is stripped and the request is served, whereas a literal/struct
 * schema would turn the same body into a 400. Preserving the value is the
 * whole fix — validating it is not this gateway's job, and a new rejection on
 * a previously-served request is a regression whatever the spec says.
 */
const AssistantMessage = S.Struct({
  role: S.Literals(["assistant"]),
  content: S.optional(S.NullOr(MessageContent)),
  name: S.optional(S.String),
  tool_calls: S.optional(S.Array(ToolCall)),
  refusal: S.optional(S.NullOr(S.String)),
  /** Hosted web-search citations — carried, never validated (see above). */
  annotations: S.optional(S.Unknown),
  /** Audio output / audio history reference — carried, never validated. */
  audio: S.optional(S.Unknown),
  /** LiteLLM / OpenAI Responses → chat stream (`reasoning_content` deltas). */
  reasoning_content: S.optional(S.NullishOr(S.String)),
  /** Terminal `response.completed` reasoning round-trip (LiteLLM `Delta.reasoning_items`). */
  reasoning_items: S.optional(S.NullishOr(S.Array(S.Unknown))),
  /** Provider-executed hosted web searches this turn (see `ServerSearchCall`).
   *  Optional on inbound history replay too — the gateway emits it, so it must
   *  also decode on the way back in (#181). */
  server_search_calls: S.optional(S.NullishOr(S.Array(ServerSearchCall))),
  cache_control: S.optional(S.NullOr(CacheControl)),
});

const ToolMessage = S.Struct({
  role: S.Literals(["tool"]),
  content: MessageContent,
  tool_call_id: S.String,
  cache_control: S.optional(S.NullOr(CacheControl)),
});

export const ChatMessage = S.Union([
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolMessage,
]);
export type TChatMessage = S.Schema.Type<typeof ChatMessage>;

const FunctionDef = S.Struct({
  name: S.String,
  description: S.optional(S.String),
  parameters: S.optional(S.Unknown),
  strict: S.optional(S.Boolean),
});

const Tool = S.Struct({
  type: S.Literals(["function"]),
  function: FunctionDef,
  cache_control: S.optional(S.NullOr(CacheControl)),
});

const ToolChoiceLiteral = S.Literals(["none", "auto", "required"]);

const ToolChoiceFunction = S.Struct({
  type: S.Literals(["function"]),
  function: S.Struct({ name: S.String }),
});

const ToolChoice = S.Union([ToolChoiceLiteral, ToolChoiceFunction]);

const ResponseFormat = S.Union([
  S.Struct({ type: S.Literals(["text"]) }),
  S.Struct({ type: S.Literals(["json_object"]) }),
  S.Struct({
    type: S.Literals(["json_schema"]),
    json_schema: S.Struct({
      name: S.String,
      description: S.optional(S.String),
      schema: S.optional(S.Unknown),
      strict: S.optional(S.Boolean),
    }),
  }),
]);

export const ChatCompletionRequest = S.Struct({
  model: S.String,
  messages: S.Array(ChatMessage),
  temperature: S.optional(S.Number),
  top_p: S.optional(S.Number),
  top_k: S.optional(S.Number),
  n: S.optional(S.Number),
  stream: S.optional(S.Boolean),
  stop: S.optional(S.Union([S.String, S.Array(S.String)])),
  max_tokens: S.optional(S.Number),
  max_completion_tokens: S.optional(S.Number),
  presence_penalty: S.optional(S.Number),
  frequency_penalty: S.optional(S.Number),
  logit_bias: S.optional(S.Record(S.String, S.Number)),
  logprobs: S.optional(S.Boolean),
  top_logprobs: S.optional(S.Number),
  seed: S.optional(S.Number),
  user: S.optional(S.String),
  tools: S.optional(S.Array(Tool)),
  tool_choice: S.optional(ToolChoice),
  parallel_tool_calls: S.optional(S.Boolean),
  /**
   * Opaque carrier for the inbound Responses-API `tools` array (Codex's
   * built-in tools: `custom` apply_patch, `web_search`, `image_generation`,
   * `tool_search`, alongside `function` tools). Canonical models only function
   * tools, so a Responses→chatgpt round-trip (Codex → daemon → chatgpt.com)
   * would otherwise lose them; this carries the ORIGINAL set verbatim and
   * `toChatGptRequest` re-emits it. Set by `fromResponsesRequest`, read ONLY by
   * `toChatGptRequest`, and STRIPPED before every openai-family upstream (it is
   * not a real OpenAI field). Mirrors `reasoning_items` (opaque Responses
   * carrier). See `@openllmsh/sdk/wire/adapters/responses`.
   */
  responses_tools: S.optional(S.Array(S.Unknown)),
  /**
   * Opaque carrier for leading Responses-API `input` items with
   * `type:"additional_tools"`. Codex v0.147 puts harness-owned namespace and
   * custom tools here, not in top-level `tools`; their position and payload are
   * part of the upstream contract. `fromResponsesRequest` preserves the whole
   * item and `toChatGptRequest` prepends it back to `input`, while every
   * non-ChatGPT upstream strips this carrier.
   */
  responses_additional_tools: S.optional(S.Array(S.Unknown)),
  /**
   * Opaque Responses `client_metadata`, currently used to carry Codex's
   * authoritative Responses-Lite marker. It is restored only for the ChatGPT
   * wire and stripped before every other upstream.
   */
  responses_client_metadata: S.optional(S.Unknown),
  stream_options: S.optional(
    S.Struct({
      include_usage: S.optional(S.Boolean),
      /**
       * Stream obfuscation (pinned spec). Padding characters on each delta to
       * normalise payload sizes against a size side-channel. Modelled so a
       * caller that DISABLES it keeps that choice — silently dropping it
       * re-enabled a mitigation the caller explicitly turned off.
       */
      include_obfuscation: S.optional(S.Unknown),
    }),
  ),
  response_format: S.optional(ResponseFormat),
  /**
   * Documented Chat Completions parameters the decoder previously dropped, so
   * an explicit caller choice never reached the upstream that honours it. Each
   * is verified present on the pinned `openai/openai-openapi` surface
   * (`tests/helpers/fixtures/openai-chat-surface.json`); the conformance suite
   * `tests/protocol/openai-chat-surface.test.ts` records a disposition for
   * every one and fails when the spec grows a field with no entry.
   *
   * ALL typed `S.Unknown`, deliberately. The gap being fixed is that these
   * values were DISCARDED, not that they were unvalidated — and a literal or
   * struct schema would make the decoder stricter than the baseline it
   * replaces, turning bodies that are served today into 400s. Carrying the
   * value verbatim fixes the loss without moving the acceptance boundary; the
   * upstream that owns each parameter remains the one that validates it.
   *
   * They are carried, not interpreted: `finalizeUpstreamBody`'s per-wire deny
   * decides which survive a given hop, and `droppedSignalParams` reports the
   * rest on `x-openllm-dropped-params` rather than letting them vanish.
   */
  service_tier: S.optional(S.Unknown),
  store: S.optional(S.Unknown),
  verbosity: S.optional(S.Unknown),
  safety_identifier: S.optional(S.Unknown),
  prompt_cache_retention: S.optional(S.Unknown),
  web_search_options: S.optional(S.Unknown),
  modalities: S.optional(S.Unknown),
  audio: S.optional(S.Unknown),
  prediction: S.optional(S.Unknown),
  // Full OpenAI-compatible enum (matches LiteLLM's accepted set so we
  // can translate the same range of efforts that `gpt-5` / Claude
  // canonical clients ship). `none` explicitly disables thinking.
  reasoning_effort: S.optional(ReasoningEffort),
  metadata: S.optional(S.Record(S.String, S.String)),
  /**
   * OpenAI prompt-cache routing hint. A stable value across the turns of one
   * conversation routes them to the same cache machine, raising the cache-hit
   * rate (and, for subscription providers like Codex, cutting quota burn). A
   * real OpenAI field — forwarded verbatim to openai-family upstreams and
   * emitted by `toChatGptRequest` for the chatgpt/Codex wire (synthesized from
   * the conversation prefix when the caller doesn't supply one). Set by
   * `fromResponsesRequest` when a Codex client already carries it.
   */
  prompt_cache_key: S.optional(S.String),
});
export type TChatCompletionRequest = S.Schema.Type<
  typeof ChatCompletionRequest
>;

export const Usage = S.Struct({
  prompt_tokens: S.Number,
  completion_tokens: S.Number,
  total_tokens: S.Number,
  prompt_tokens_details: S.optional(
    S.Struct({
      cached_tokens: S.optional(S.Number),
      cache_creation_tokens: S.optional(S.Number),
      audio_tokens: S.optional(S.Number),
    }),
  ),
  completion_tokens_details: S.optional(
    S.Struct({
      reasoning_tokens: S.optional(S.Number),
      audio_tokens: S.optional(S.Number),
      accepted_prediction_tokens: S.optional(S.Number),
      rejected_prediction_tokens: S.optional(S.Number),
    }),
  ),
});
export type TUsage = S.Schema.Type<typeof Usage>;

const FinishReason = S.Literals([
  "stop",
  "length",
  "content_filter",
  "tool_calls",
  "function_call",
]);

const ChatChoice = S.Struct({
  index: S.Number,
  message: AssistantMessage,
  finish_reason: S.NullOr(FinishReason),
  logprobs: S.optional(S.NullOr(S.Unknown)),
});

export const ChatCompletionResponse = S.Struct({
  id: S.String,
  object: S.Literals(["chat.completion"]),
  created: S.Number,
  model: S.String,
  choices: S.Array(ChatChoice),
  usage: Usage,
  system_fingerprint: S.optional(S.NullOr(S.String)),
  /**
   * Response metadata the decoder previously discarded. `service_tier` is the
   * tier that ACTUALLY served the request (it can differ from the requested
   * one, which is the only way a caller learns their `priority` request was
   * served on `default`); `moderation` carries moderated-completion results;
   * `metadata` echoes the request's key/value map. Opaque `moderation` on
   * purpose — it is OpenAI's own result object and the gateway re-emits it
   * verbatim rather than modelling a surface it does not interpret.
   */
  service_tier: S.optional(S.Unknown),
  metadata: S.optional(S.Unknown),
  moderation: S.optional(S.Unknown),
});
export type TChatCompletionResponse = S.Schema.Type<
  typeof ChatCompletionResponse
>;

// OpenAI-compatible providers (Alibaba DashScope / qwen, Kimi, etc.)
// don't strictly follow OpenAI's wire shape: continuation chunks may
// omit `finish_reason` entirely and set every "this isn't set this
// chunk" field to `null` (rather than dropping the key). If we treat
// these as schema violations the chunk is silently dropped at the
// `providerEventStream` decoder and the tool-call argument fragment it
// was carrying is lost — observed in prod as `Edit` / `Bash` called
// with missing required parameters (`command`, `file_path`, …) and
// `/compact` failing with "no valid text content" when the only
// surviving chunk is the terminal one.
//
// `S.NullishOr(X)` ≡ `X | null | undefined` and pairs with
// `S.optional(...)` to accept (1) absent, (2) explicit-null, and
// (3) the wanted type. Every nullable-by-OpenAI field uses it.
const ChatChunkDelta = S.Struct({
  role: S.optional(S.NullishOr(S.Literals(["assistant"]))),
  content: S.optional(S.NullishOr(S.String)),
  tool_calls: S.optional(
    S.NullishOr(
      S.Array(
        S.Struct({
          index: S.Number,
          id: S.optional(S.NullishOr(S.String)),
          type: S.optional(
            S.NullishOr(S.Literals(["function", "builtin_function"])),
          ),
          function: S.optional(
            S.NullishOr(
              S.Struct({
                name: S.optional(S.NullishOr(S.String)),
                arguments: S.optional(S.NullishOr(S.String)),
              }),
            ),
          ),
        }),
      ),
    ),
  ),
  refusal: S.optional(S.NullishOr(S.String)),
  reasoning_content: S.optional(S.NullishOr(S.String)),
  reasoning_items: S.optional(S.NullishOr(S.Array(S.Unknown))),
  /** Provider-executed hosted web searches, emitted once per completed
   *  provider search item (see `ServerSearchCall`). */
  server_search_calls: S.optional(S.NullishOr(S.Array(ServerSearchCall))),
});

const ChatChunkChoice = S.Struct({
  index: S.Number,
  delta: ChatChunkDelta,
  // `finish_reason` is *optional* on continuation chunks for many
  // OpenAI-compatible providers (qwen3-coder, kimi, ...) — only the
  // terminal chunk carries it. `S.optional(S.NullishOr(...))` lets it
  // be absent, null, or a real reason without dropping the chunk.
  finish_reason: S.optional(S.NullishOr(FinishReason)),
  logprobs: S.optional(S.NullishOr(S.Unknown)),
});

export const ChatCompletionChunk = S.Struct({
  id: S.String,
  object: S.Literals(["chat.completion.chunk"]),
  created: S.Number,
  model: S.String,
  choices: S.Array(ChatChunkChoice),
  usage: S.optional(S.NullOr(Usage)),
  system_fingerprint: S.optional(S.NullOr(S.String)),
  /**
   * Per-chunk metadata the decoder previously discarded. `obfuscation` is the
   * side-channel padding string the caller opted into via
   * `stream_options.include_obfuscation` — re-emitting it is what makes that
   * opt-in real end to end, since a mitigation the gateway strips is no
   * mitigation. `service_tier` / `moderation` mirror the non-streaming
   * response.
   */
  obfuscation: S.optional(S.Unknown),
  service_tier: S.optional(S.Unknown),
  moderation: S.optional(S.Unknown),
});
export type TChatCompletionChunk = S.Schema.Type<typeof ChatCompletionChunk>;
