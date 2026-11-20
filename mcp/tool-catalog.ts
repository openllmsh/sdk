/**
 * THE tool catalog every OpenLLM tool host builds its listing from — the
 * `openllm mcp` server and the browser chat alike, so what is listed, what
 * is found on demand, how listed schemas are shortened and how the two
 * lookup tools answer live in one place.
 *
 * A host hands in its tools (each with how to run it, in the host's own
 * result shape) and gets back:
 *  - {@link TToolCatalog.listed}: what to send on every request — the tools
 *    marked `listed`, schemas compacted, plus {@link OPENLLM_API_FIND_TOOL}
 *    and {@link OPENLLM_API_CALL_TOOL};
 *  - {@link TToolCatalog.call}: the dispatcher for any listed tool and the
 *    two lookup tools.
 *
 * Which tools are listed is shared policy too: {@link isListedOperation} for
 * native-API operations, {@link upstreamCatalogTools} for marketplace
 * integrations. Everything else stays one search away.
 */

import type { TCompactionLimits, TLookupEntry } from "./tool-lookup";
import {
  compactToolSchema,
  findLookupEntries,
  isCoreTool,
  lookupDetailsNote,
  lookupGroups,
  lookupToolSpecs,
  parseLookupCall,
} from "./tool-lookup";
import {
  OPENLLM_API_CALL_TOOL,
  OPENLLM_API_FIND_TOOL,
} from "./tool-lookup-names";
import type {
  TUpstream,
  TUpstreamToolEntriesOptions,
} from "./tools/marketplace";
import { upstreamToolEntries } from "./tools/marketplace";

/** OpenLLM Memory's marketplace catalog id. */
const MEMORY_ENTRY_ID = "openllm-memory";

/** Listed tools are cut this far: every full text is one find away. */
export const LISTING_LIMITS: TCompactionLimits = { tool: 300, param: 100 };

/** Core operations found on demand rather than listed: video-job follow-ups
 *  (only useful once a job exists) and a provider's raw model list
 *  (`api_v1Models_list` already answers "what can I use"). */
const DEFERRED_CORE_OPERATIONS: ReadonlySet<string> = new Set([
  "api_v1Videos_videosRetrieve",
  "api_v1Videos_videosContent",
  "api_v1Videos_videosDelete",
  "api_providerModels_list",
]);

/** True for a native-API operation every host lists as a tool. */
export const isListedOperation = (name: string): boolean =>
  isCoreTool(name) && !DEFERRED_CORE_OPERATIONS.has(name);

/** Memory tools an agent rarely needs up front. */
const DEFERRED_MEMORY_TOOLS: ReadonlySet<string> = new Set(["whoAmI"]);

export type TToolAnnotations = {
  readonly title?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
};

/** One tool a host offers, run in the host's own result shape. */
export type TCatalogTool<TResult> = TLookupEntry & {
  readonly annotations?: TToolAnnotations;
  /** Sent on every request; otherwise found on demand. */
  readonly listed: boolean;
  readonly run: (args: Record<string, unknown>) => Promise<TResult>;
};

/** What a host sends: name, (compacted) description, schema. */
export type TListedTool = TLookupEntry & {
  readonly annotations?: TToolAnnotations;
};

export type TToolCatalog<TResult> = {
  /** Listed tools (compacted), then the two lookup tools. */
  readonly listed: () => ReadonlyArray<TListedTool>;
  /** Run a listed tool or a lookup tool; null for any other name. */
  readonly call: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<TResult> | null;
  /** Add tools (e.g. integrations that connected late); returns the newly
   *  listed ones, compacted. */
  readonly add: (
    tools: ReadonlyArray<TCatalogTool<TResult>>,
  ) => ReadonlyArray<TListedTool>;
  /** Names already in the catalog (listed, deferred, lookup tools). */
  readonly names: () => ReadonlySet<string>;
};

/**
 * A catalog over `tools`; `text` turns a lookup answer (or error) into the
 * host's result shape.
 */
export const createToolCatalog = <TResult>(
  tools: ReadonlyArray<TCatalogTool<TResult>>,
  text: (body: string, isError: boolean) => TResult,
): TToolCatalog<TResult> => {
  const listed = new Map<string, TCatalogTool<TResult>>();
  const sent = new Map<string, TListedTool>();
  const deferred = new Map<string, TCatalogTool<TResult>>();
  /** Listed tools whose text was cut: their full schema is one find away. */
  const shortened = new Map<string, TLookupEntry>();

  const add = (
    more: ReadonlyArray<TCatalogTool<TResult>>,
  ): ReadonlyArray<TListedTool> => {
    const added: TListedTool[] = [];
    for (const tool of more) {
      if (listed.has(tool.name) || deferred.has(tool.name)) continue;
      if (!tool.listed) {
        deferred.set(tool.name, tool);
        continue;
      }
      const compacted = compactToolSchema(
        tool,
        lookupDetailsNote,
        LISTING_LIMITS,
      );
      if (compacted.shortened) shortened.set(tool.name, tool);
      const out: TListedTool = {
        ...compacted.tool,
        ...(tool.annotations === undefined
          ? {}
          : { annotations: tool.annotations }),
      };
      listed.set(tool.name, tool);
      sent.set(tool.name, out);
      added.push(out);
    }
    return added;
  };
  add(tools);

  const lookupTools = (): ReadonlyArray<TListedTool> => {
    const [find, call] = lookupToolSpecs(lookupGroups([...deferred.values()]));
    return [
      ...(find === undefined
        ? []
        : [{ ...find, annotations: { readOnlyHint: true } }]),
      ...(call === undefined ? [] : [call]),
    ];
  };

  return {
    listed: () => [...sent.values(), ...lookupTools()],
    add,
    names: () =>
      new Set([
        ...listed.keys(),
        ...deferred.keys(),
        OPENLLM_API_FIND_TOOL,
        OPENLLM_API_CALL_TOOL,
      ]),
    call: (name, args) => {
      if (name === OPENLLM_API_FIND_TOOL) {
        return Promise.resolve(
          text(
            findLookupEntries(
              [...deferred.values(), ...shortened.values()],
              typeof args.query === "string" ? args.query : "",
            ),
            false,
          ),
        );
      }
      if (name === OPENLLM_API_CALL_TOOL) {
        const call = parseLookupCall(args, (n) => deferred.has(n));
        if ("error" in call) return Promise.resolve(text(call.error, true));
        const tool = deferred.get(call.name);
        return tool === undefined
          ? Promise.resolve(text(`Unknown tool: ${call.name}`, true))
          : tool.run(call.arguments);
      }
      return listed.get(name)?.run(args) ?? null;
    },
  };
};

/** The lookup tools' names: the only ones {@link TToolCatalog.call} owns
 *  beyond the listed tools. */
export const isLookupTool = (name: string): boolean =>
  name === OPENLLM_API_FIND_TOOL || name === OPENLLM_API_CALL_TOOL;

/**
 * Marketplace integrations as catalog tools: OpenLLM Memory is listed (bar
 * `whoAmI`), every other integration is found on demand. `run` adapts an
 * upstream call to the host's result shape.
 */
export const upstreamCatalogTools = <TResult>(
  upstreams: readonly TUpstream[],
  run: (
    upstream: TUpstream,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<TResult>,
  options: TUpstreamToolEntriesOptions = {},
): ReadonlyArray<TCatalogTool<TResult>> =>
  upstreamToolEntries(upstreams, options).map(
    ({ name, upstream, tool }): TCatalogTool<TResult> => ({
      name,
      description: tool.description ?? `${upstream.id}: ${tool.name}`,
      inputSchema: tool.inputSchema,
      ...(tool.annotations === undefined
        ? {}
        : { annotations: tool.annotations as TToolAnnotations }),
      listed:
        upstream.id === MEMORY_ENTRY_ID &&
        !DEFERRED_MEMORY_TOOLS.has(tool.name),
      run: (args) => run(upstream, tool.name, args),
    }),
  );
