import type { TAttemptUsage } from "./attempt-outcome";
import { sseEventStream } from "./streaming/sse";

export type TUsageProtocol = "openai" | "anthropic" | "embeddings" | "none";
export type TUsageTransport = "json" | "sse" | "error";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const extract = (
  body: unknown,
  protocol: TUsageProtocol,
): TAttemptUsage | null => {
  if (protocol === "none") return null;
  const root = record(body);
  const owner = record(root?.response) ?? root;
  const usage = record(owner?.usage);
  if (usage === null) return null;
  const input =
    protocol === "anthropic"
      ? usage.input_tokens
      : (usage.prompt_tokens ?? usage.input_tokens);
  const output =
    protocol === "embeddings"
      ? 0
      : protocol === "anthropic"
        ? usage.output_tokens
        : (usage.completion_tokens ?? usage.output_tokens);
  if (!count(input) || !count(output)) return null;
  const separateCache =
    protocol === "anthropic" ||
    (usage.prompt_tokens === undefined &&
      usage.input_tokens_details === undefined);
  const read = separateCache ? (usage.cache_read_input_tokens ?? 0) : 0;
  const write = separateCache ? (usage.cache_creation_input_tokens ?? 0) : 0;
  if (!count(read) || !count(write) || !Number.isFinite(input + read + write))
    return null;
  // Fractional counts are floored, per side, like every cap settlement.
  const details =
    record(usage.prompt_tokens_details) ?? record(usage.input_tokens_details);
  const detailCached = details?.cached_tokens;
  const detailCreated = details?.cache_creation_tokens;
  const cached =
    protocol === "anthropic" ? read : count(detailCached) ? detailCached : 0;
  const cacheCreation =
    protocol === "anthropic" ? write : count(detailCreated) ? detailCreated : 0;
  return {
    in: Math.floor(input) + Math.floor(read) + Math.floor(write),
    out: Math.floor(output),
    cached: Math.floor(cached),
    cacheCreation: Math.floor(cacheCreation),
  };
};

/** Incrementally observes already-read objects or a separately drained SSE stream. */
export const createUsageObserver = (
  protocol: TUsageProtocol,
  transport: TUsageTransport,
): {
  observe: (body: unknown) => void;
  observeStream: (stream: ReadableStream<Uint8Array>) => Promise<void>;
  usage: () => TAttemptUsage | null;
} => {
  let last: TAttemptUsage | null = null;
  const anthropicUsage: Record<string, unknown> = {};
  const observe = (body: unknown): void => {
    let next: TAttemptUsage | null;
    if (protocol === "anthropic" && transport === "sse") {
      const event = record(body);
      const delta = event?.type === "message_delta";
      const incoming = record(
        delta
          ? event?.usage
          : event?.type === "message_start"
            ? record(event.message)?.usage
            : null,
      );
      if (incoming === null) return;
      for (const key of [
        "input_tokens",
        "output_tokens",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
      ] as const) {
        const value = incoming[key];
        if (count(value)) anthropicUsage[key] = value;
        // NaN (not null) so `?? 0` cannot turn an invalid count into zero.
        else if (value !== null && value !== undefined)
          anthropicUsage[key] = Number.NaN;
      }
      if (!delta || !count(incoming.output_tokens)) return;
      next = extract({ usage: anthropicUsage }, protocol);
    } else {
      next = extract(body, protocol);
    }
    if (next !== null) last = next;
  };
  const observeStream = async (
    stream: ReadableStream<Uint8Array>,
  ): Promise<void> => {
    const reader = sseEventStream(stream).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value.kind !== "data") continue;
        try {
          observe(JSON.parse(value.data));
        } catch {
          /* Ignore malformed events. */
        }
      }
    } catch {
      // Complete usage observed before a stream failure remains authoritative.
    } finally {
      reader.releaseLock();
    }
  };
  return { observe, observeStream, usage: () => last };
};
