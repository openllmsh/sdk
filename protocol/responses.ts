import { Schema as S } from "effect";
import { ReasoningEffort } from "./chat";

/**
 * OpenAI **Responses API** wire types (`POST /v1/responses`) — the inbound
 * surface the Codex CLI speaks (it dropped chat-completions: `wire_api="chat"`
 * errors). We model the SUBSET Codex emits + expects; unknown extra keys are
 * tolerated (the structs aren't sealed). The gateway adapts a Responses
 * request → canonical ChatCompletion (`@openllmsh/sdk/wire/adapters/responses`), runs
 * the normal pipeline, and adapts the canonical response/stream back to
 * Responses shape.
 *
 * The request shape mirrors (inverts) `toChatGptRequest`'s body in
 * `@openllmsh/sdk/wire/providers/chatgpt/request.ts`, which is the same Responses
 * API the daemon already speaks UPSTREAM to chatgpt.com.
 */

// ─── Request ─────────────────────────────────────────────────────────

const ResponsesInputContentPart = S.Union([
  S.Struct({ type: S.Literals(["input_text"]), text: S.String }),
  S.Struct({ type: S.Literals(["output_text"]), text: S.String }),
  S.Struct({
    type: S.Literals(["input_image"]),
    image_url: S.String,
    detail: S.optional(S.Literals(["auto", "low", "high"])),
  }),
  S.Struct({
    type: S.Literals(["input_file"]),
    filename: S.optional(S.String),
    // Data URL (`data:<mime>;base64,<b64>`) — same encoding as the
    // canonical chat `file` part's `file_data`.
    file_data: S.optional(S.String),
    file_id: S.optional(S.NullOr(S.String)),
  }),
]);

// `type` is optional on message items, as in the OpenAI Responses API: an
// input item carrying only `role` + `content` is a message. Every other item
// kind has a required, distinct `type`, so the union still discriminates.
const ResponsesMessageItem = S.Struct({
  type: S.optional(S.Literals(["message"])),
  role: S.Literals(["user", "assistant", "system", "developer"]),
  // Responses allows a bare string or an array of typed parts.
  content: S.Union([S.String, S.Array(ResponsesInputContentPart)]),
});

const ResponsesFunctionCallItem = S.Struct({
  type: S.Literals(["function_call"]),
  call_id: S.String,
  name: S.String,
  /** Codex namespace-scoped tools (MCP servers, …) name their group here. */
  namespace: S.optional(S.String),
  arguments: S.String,
  id: S.optional(S.String),
});

const ResponsesFunctionCallOutputItem = S.Struct({
  type: S.Literals(["function_call_output"]),
  call_id: S.String,
  output: S.Union([S.String, S.Array(ResponsesInputContentPart)]),
});

/**
 * A reasoning item echoed back on a follow-up turn (Codex replays these for
 * `store:false` reasoning models). Opaque here — the adapter carries it onto
 * the canonical assistant's `reasoning_items` so it round-trips intact.
 */
const ResponsesReasoningItem = S.Struct({
  type: S.Literals(["reasoning"]),
  id: S.optional(S.String),
  summary: S.optional(S.Unknown),
  content: S.optional(S.Unknown),
  encrypted_content: S.optional(S.NullishOr(S.String)),
});

/**
 * A tool definition in the Responses API. Codex ships a MIX on every request:
 * classic `function` tools (`exec_command`, `update_plan`, `view_image`, …)
 * AND built-in non-function tools — `custom` (the freeform-grammar
 * `apply_patch`), `web_search`, `image_generation`, `tool_search`. We accept
 * ALL of them: the old `type: "function"`-only struct made the whole `tools`
 * array fail decode → a hard 400 on every Codex request. The index signature
 * (`S.Record`) preserves each tool's extra keys verbatim (`format`,
 * `external_web_access`, `output_format`, …) so the chatgpt round-trip can
 * re-emit them intact via the canonical `responses_tools` passthrough. `name`
 * is optional — `web_search` / `image_generation` carry none.
 */
const ResponsesToolDef = S.StructWithRest(
  S.Struct({
    type: S.String,
    name: S.optional(S.String),
    description: S.optional(S.NullishOr(S.String)),
    parameters: S.optional(S.Unknown),
    strict: S.optional(S.NullishOr(S.Boolean)),
  }),
  [S.Record(S.String, S.Unknown)],
);

/**
 * Codex v0.147 carries its harness-owned tools as the first Responses input
 * item rather than in the top-level `tools` array. The tool definitions remain
 * opaque so nested namespaces and freeform custom tools round-trip intact.
 */
const ResponsesAdditionalToolsItem = S.Struct({
  type: S.Literals(["additional_tools"]),
  role: S.Literals(["developer"]),
  tools: S.Array(ResponsesToolDef),
});

/**
 * A call to OpenAI's hosted `apply_patch` tool replayed on a follow-up turn
 * (the OpenAI Agents SDK echoes these). The adapter maps it to a function call
 * to the tool's canonical stand-in; `operation` stays opaque here.
 */
const ResponsesApplyPatchCallItem = S.Struct({
  type: S.Literals(["apply_patch_call"]),
  call_id: S.String,
  id: S.optional(S.String),
  status: S.optional(S.String),
  operation: S.Unknown,
});

const ResponsesApplyPatchCallOutputItem = S.Struct({
  type: S.Literals(["apply_patch_call_output"]),
  call_id: S.String,
  id: S.optional(S.String),
  status: S.optional(S.String),
  output: S.optional(S.NullishOr(S.String)),
});

export const ResponsesInputItem = S.Union([
  ResponsesMessageItem,
  ResponsesFunctionCallItem,
  ResponsesFunctionCallOutputItem,
  ResponsesReasoningItem,
  ResponsesAdditionalToolsItem,
  ResponsesApplyPatchCallItem,
  ResponsesApplyPatchCallOutputItem,
]);
export type TResponsesAdditionalToolsItem = S.Schema.Type<
  typeof ResponsesAdditionalToolsItem
>;
export type TResponsesInputItem = S.Schema.Type<typeof ResponsesInputItem>;

/**
 * `allowed_tools` restricts one turn to a subset of the declared tools while
 * the full list stays in the prompt (the OpenAI Agents SDK sends it every
 * turn). Entries are tool references: `{type:"function", name}` or a
 * non-function tool's bare `{type}`. `{type:"apply_patch"}` forces the hosted
 * patch tool.
 */
const ResponsesAllowedToolsChoice = S.Struct({
  type: S.Literals(["allowed_tools"]),
  mode: S.Literals(["auto", "required"]),
  tools: S.Array(
    S.StructWithRest(S.Struct({ type: S.String, name: S.optional(S.String) }), [
      S.Record(S.String, S.Unknown),
    ]),
  ),
});

const ResponsesToolChoice = S.Union([
  S.Literals(["auto", "none", "required"]),
  S.Struct({ type: S.Literals(["function"]), name: S.String }),
  S.Struct({ type: S.Literals(["apply_patch"]) }),
  ResponsesAllowedToolsChoice,
]);

export const ResponsesRequest = S.Struct({
  model: S.String,
  service_tier: S.optional(S.Unknown),
  // `input` is either a bare prompt string or the ordered item array.
  input: S.Union([S.String, S.Array(ResponsesInputItem)]),
  instructions: S.optional(S.NullishOr(S.String)),
  // Nullish, not just optional: Codex emits explicit `null`s for unset fields.
  tools: S.optional(S.NullishOr(S.Array(ResponsesToolDef))),
  tool_choice: S.optional(S.NullishOr(ResponsesToolChoice)),
  // Codex sends `reasoning: null` (not just omitted) when the effort is
  // `none` — so the whole object must be nullish, not only its `effort`.
  reasoning: S.optional(
    S.NullishOr(
      S.Struct({
        effort: S.optional(S.NullishOr(ReasoningEffort)),
      }),
    ),
  ),
  max_output_tokens: S.optional(S.NullishOr(S.Number)),
  temperature: S.optional(S.NullishOr(S.Number)),
  top_p: S.optional(S.NullishOr(S.Number)),
  stream: S.optional(S.NullishOr(S.Boolean)),
  parallel_tool_calls: S.optional(S.NullishOr(S.Boolean)),
  /**
   * Codex Desktop mirrors its Responses-Lite websocket header here as
   * `ws_request_header_x_openai_internal_codex_responses_lite`. Preserve this
   * opaque object through the canonical round-trip so ChatGPT can apply its
   * Lite-specific request requirements without guessing from a model id.
   */
  client_metadata: S.optional(S.Unknown),
  // Tolerated + ignored (Codex sets these); kept off the canonical mapping.
  store: S.optional(S.NullishOr(S.Boolean)),
  previous_response_id: S.optional(S.NullishOr(S.String)),
  // Codex sends this per conversation (stable across turns) to route prompt-cache
  // hits — preserve it so the daemon's re-encoded upstream keeps the same key
  // rather than dropping it. See `fromResponsesRequest` / `toChatGptRequest`.
  prompt_cache_key: S.optional(S.NullishOr(S.String)),
});
export type TResponsesRequest = S.Schema.Type<typeof ResponsesRequest>;

// ─── Response (non-streaming) ────────────────────────────────────────

const ResponsesOutputTextPart = S.Struct({
  type: S.Literals(["output_text"]),
  text: S.String,
  annotations: S.optional(S.Array(S.Unknown)),
});

const ResponsesOutputMessage = S.Struct({
  type: S.Literals(["message"]),
  id: S.String,
  role: S.Literals(["assistant"]),
  status: S.Literals(["completed", "in_progress", "incomplete"]),
  content: S.Array(ResponsesOutputTextPart),
});

const ResponsesOutputFunctionCall = S.Struct({
  type: S.Literals(["function_call"]),
  id: S.String,
  call_id: S.String,
  name: S.String,
  /** Set for Codex namespace-scoped tools; Codex routes the call by it. */
  namespace: S.optional(S.String),
  arguments: S.String,
  status: S.optional(S.Literals(["completed", "in_progress", "incomplete"])),
});

const ResponsesOutputReasoning = S.Struct({
  type: S.Literals(["reasoning"]),
  id: S.String,
  summary: S.Array(S.Unknown),
  encrypted_content: S.optional(S.NullishOr(S.String)),
});

/** A call to the hosted `apply_patch` tool, as OpenAI's API returns it. */
const ResponsesOutputApplyPatchCall = S.Struct({
  type: S.Literals(["apply_patch_call"]),
  id: S.String,
  call_id: S.String,
  status: S.Literals(["completed", "in_progress"]),
  operation: S.Struct({
    type: S.Literals(["create_file", "update_file", "delete_file"]),
    path: S.String,
    diff: S.optional(S.String),
  }),
});

export const ResponsesOutputItem = S.Union([
  ResponsesOutputMessage,
  ResponsesOutputFunctionCall,
  ResponsesOutputReasoning,
  ResponsesOutputApplyPatchCall,
]);
export type TResponsesOutputItem = S.Schema.Type<typeof ResponsesOutputItem>;

export const ResponsesUsage = S.Struct({
  input_tokens: S.Number,
  output_tokens: S.Number,
  total_tokens: S.Number,
});

export const ResponsesResponse = S.Struct({
  id: S.String,
  object: S.Literals(["response"]),
  created_at: S.Number,
  status: S.Literals(["completed", "incomplete", "failed", "in_progress"]),
  model: S.String,
  output: S.Array(ResponsesOutputItem),
  usage: S.optional(ResponsesUsage),
});
export type TResponsesResponse = S.Schema.Type<typeof ResponsesResponse>;
