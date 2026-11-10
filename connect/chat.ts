import { sseEventStream } from "@openllmsh/sdk/wire/lib/streaming/sse";

export type TChatRole = "system" | "user" | "assistant";

export type TChatMessage = {
  readonly role: TChatRole;
  readonly content: string;
};

/** One `/v1/chat/completions` request; extra fields pass through as-is. */
export type TChatParams = {
  /** An alias (`plus`, `ultra`, `lite`), a custom alias or `provider/model`. */
  readonly model: string;
  readonly messages: readonly TChatMessage[];
} & Readonly<Record<string, unknown>>;

export type TModelInfo = {
  readonly id: string;
  readonly owned_by?: string;
} & Readonly<Record<string, unknown>>;

/** The three aliases every account has, in the order apps usually offer them. */
export const MODEL_ALIASES = ["plus", "ultra", "lite"] as const;

type TChunk = {
  readonly choices?: readonly {
    readonly delta?: { readonly content?: unknown };
  }[];
};

/**
 * A `/v1/chat/completions` stream (`text/event-stream`) as its text deltas.
 * Comments, keepalives, tool-call and usage chunks are dropped.
 */
export const chatTextStream = (
  body: ReadableStream<Uint8Array>,
): ReadableStream<string> =>
  sseEventStream(body).pipeThrough(
    new TransformStream({
      transform(event, controller): void {
        if (event.kind !== "data") return;
        let chunk: TChunk;
        try {
          chunk = JSON.parse(event.data) as TChunk;
        } catch {
          return;
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0)
          controller.enqueue(delta);
      },
    }),
  );

/** Text deltas as UTF-8 bytes, ready to be a `Response` body. */
export const encodeTextStream = (
  text: ReadableStream<string>,
): ReadableStream<Uint8Array> => text.pipeThrough(new TextEncoderStream());
