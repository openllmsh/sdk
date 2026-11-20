/**
 * Transport-free MCP server factory for OpenLLM.
 *
 * Hosts (CLI `openllm mcp`, browser chat, external runtimes) inject version,
 * already-resolved groups, gateway credentials, and optional handlers. This
 * module never touches stdio, CLI onboarding, or local-auth tools.
 */

import type {
  CallToolResult,
  RegisteredTool,
} from "@modelcontextprotocol/server";
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import type { TPermission } from "@openllmsh/sdk/protocol";
import { Permission } from "@openllmsh/sdk/protocol";

export type { TPermission };

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(Permission.literals);

/**
 * The `permissions` of an `/api/user/tier` answer, keeping only names this
 * SDK knows; `undefined` when absent (an older gateway: list everything and
 * let the gateway refuse what the key can't do).
 */
export const parseKeyPermissions = (
  value: unknown,
): readonly TPermission[] | undefined =>
  Array.isArray(value)
    ? value.filter(
        (p): p is TPermission =>
          typeof p === "string" && KNOWN_PERMISSIONS.has(p),
      )
    : undefined;

import type { TLookupEntry } from "./tool-lookup";
import {
  compactToolSchema,
  findLookupEntries,
  isMcpCoreTool,
  lookupDetailsNote,
  lookupGroups,
  lookupToolSpecs,
  MCP_LISTING_LIMITS,
  parseLookupCall,
} from "./tool-lookup";
import type {
  TMarketplaceLaunch,
  TMarketplaceLaunchServer,
  TUpstream,
} from "./tools/marketplace";
import {
  connectUpstreams,
  fetchMarketplaceLaunch,
  LAUNCH_TIMEOUT_MS,
  upstreamToolEntries,
} from "./tools/marketplace";
import {
  MODELS_TOOL_NAME,
  prioritizeSubscriptionModels,
} from "./tools/model-priority";
import {
  handleOpenllmTool,
  isFreeTierOnlyTool,
  openllmToolDefs,
  TRANSCRIPTION_TOOL_NAME,
} from "./tools/openllm";
import type { TToolResult } from "./types";

/** Catalog id for the OpenLLM Memory marketplace entry. */
export const OPENLLM_MEMORY_ENTRY_ID = "openllm-memory";
/** @deprecated Use {@link OPENLLM_MEMORY_ENTRY_ID}. */
export const OPENLLM_MEMORY_BUILTIN_ID = OPENLLM_MEMORY_ENTRY_ID;

export type TMcpGatewayConfig = {
  readonly baseUrl: string;
  readonly apiKey: string;
};

export type TCreateMcpServerOptions = {
  /** Injected package / binary version for `serverInfo`. */
  readonly version: string;
  /** Already-resolved tool groups (e.g. `["openllm", "openllm-memory"]`). */
  readonly groups: readonly string[];
  readonly config: TMcpGatewayConfig;
  readonly upstreams?: readonly TUpstream[];
  /**
   * When true, Gravity Index (free-tier-only) tools are registered. Defaults
   * to false — unknown / paid tiers hide them.
   */
  readonly includeFreeTierOnlyTools?: boolean;
  /**
   * Optional local transcription handler. The transcription tool is only
   * registered when this is provided — the SDK never reads local files.
   */
  readonly transcribe?: (
    args: Record<string, unknown>,
    config: TMcpGatewayConfig,
  ) => Promise<TToolResult>;
  /**
   * The calling key's permissions (`/api/user/tier`). When given, only tools
   * the key may call are listed — a run-AI key is never offered account
   * endpoints the gateway would refuse. Omit when unknown (fail open: the
   * gateway still enforces every call).
   */
  readonly permissions?: readonly TPermission[];
  /** Host tools (e.g. the CLI's local-auth group), listed or deferred. */
  readonly hostTools?: readonly THostTool[];
};

type TToolAnnotations = {
  readonly title?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
};

/** A host-provided tool (e.g. the CLI's local-auth group). */
export type THostTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: TToolAnnotations;
  /** Listed on every request; otherwise found on demand. */
  readonly listed: boolean;
  readonly run: (args: Record<string, unknown>) => Promise<TToolResult>;
};

type TEntry = TLookupEntry & {
  readonly annotations?: TToolAnnotations;
  readonly run: (args: Record<string, unknown>) => Promise<CallToolResult>;
};

/** Per-server lookup state: what the find/call tools search and run. */
type TLookupState = {
  /** Tools reached only through {@link OPENLLM_API_CALL_TOOL}. */
  readonly deferred: Map<string, TEntry>;
  /** Listed tools whose schema was shortened: full text via find. */
  readonly shortened: Map<string, TLookupEntry>;
  readonly registered: Set<string>;
  readonly find: RegisteredTool;
};

/** Memory tools an agent rarely needs up front. */
const MEMORY_DEFERRED_TOOLS: ReadonlySet<string> = new Set(["whoAmI"]);

const lookupStates = new WeakMap<McpServer, TLookupState>();

const toolConfig = (
  tool: TLookupEntry & { readonly annotations?: TToolAnnotations },
): Parameters<McpServer["registerTool"]>[1] =>
  ({
    description: tool.description,
    ...(tool.annotations === undefined
      ? {}
      : { annotations: tool.annotations }),
    // MCP server overloads accept either Zod shapes or StandardSchemaV1;
    // `fromJsonSchema` returns the latter. Cast through unknown to the
    // registerTool config slot so we don't depend on a Zod-shaped overload.
    inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema),
  }) as unknown as Parameters<McpServer["registerTool"]>[1];

const errorResult = (text: string): TToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

/** List `entry` (schema compacted) or defer it to the lookup tools. */
const addEntry = (
  server: McpServer,
  state: TLookupState,
  entry: TEntry,
  listed: boolean,
): void => {
  state.registered.add(entry.name);
  if (!listed) {
    state.deferred.set(entry.name, entry);
    return;
  }
  const compacted = compactToolSchema(
    entry,
    lookupDetailsNote,
    MCP_LISTING_LIMITS,
  );
  if (compacted.shortened) state.shortened.set(entry.name, entry);
  server.registerTool(
    entry.name,
    toolConfig({ ...compacted.tool, annotations: entry.annotations }),
    (args: Record<string, unknown>) => entry.run(args),
  );
};

const findDescription = (state: TLookupState): string =>
  lookupToolSpecs(lookupGroups([...state.deferred.values()]))[0]?.description ??
  "";

/** Register the two lookup tools; returns the per-server state. */
const registerLookupTools = (server: McpServer): TLookupState => {
  const [findSpec, callSpec] = lookupToolSpecs([]);
  if (findSpec === undefined || callSpec === undefined)
    throw new Error("lookup tool specs missing");
  const deferred = new Map<string, TEntry>();
  const shortened = new Map<string, TLookupEntry>();
  const find = server.registerTool(
    findSpec.name,
    toolConfig({ ...findSpec, annotations: { readOnlyHint: true } }),
    async (args: Record<string, unknown>): Promise<TToolResult> => ({
      content: [
        {
          type: "text",
          text: findLookupEntries(
            [...deferred.values(), ...shortened.values()],
            typeof args.query === "string" ? args.query : "",
          ),
        },
      ],
    }),
  );
  server.registerTool(
    callSpec.name,
    toolConfig(callSpec),
    async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const call = parseLookupCall(args, (name) => deferred.has(name));
      if ("error" in call) return errorResult(call.error);
      const entry = deferred.get(call.name);
      if (entry === undefined) return errorResult(`Unknown tool: ${call.name}`);
      return entry.run(call.arguments);
    },
  );
  const state: TLookupState = {
    deferred,
    shortened,
    registered: new Set([findSpec.name, callSpec.name]),
    find,
  };
  lookupStates.set(server, state);
  return state;
};

/**
 * One registration path for both negotiated stdio eras and local tests.
 *
 * Only the tools a conversation uses are LISTED (`isMcpCoreTool`, host tools
 * marked `listed`, the Memory integration), each schema compacted; every
 * other permitted tool — account reads, the rest of a host group, other
 * marketplace integrations — is found and run through the two lookup tools,
 * so the listing stays small whatever is enabled.
 */
export const createMcpServer = ({
  version,
  groups,
  config,
  upstreams = [],
  includeFreeTierOnlyTools = false,
  transcribe,
  permissions,
  hostTools = [],
}: TCreateMcpServerOptions): McpServer => {
  const held =
    permissions === undefined ? undefined : new Set<string>(permissions);
  const openllmTools = groups.includes("openllm")
    ? openllmToolDefs.filter((tool) => {
        if (held !== undefined && !held.has(tool.permission)) return false;
        if (!includeFreeTierOnlyTools && isFreeTierOnlyTool(tool.name))
          return false;
        // Transcription needs a host-provided local-file handler.
        if (tool.name === TRANSCRIPTION_TOOL_NAME && transcribe === undefined)
          return false;
        return true;
      })
    : [];
  const server = new McpServer(
    { name: "openllm", version },
    { capabilities: { tools: {} } },
  );
  const state = registerLookupTools(server);
  for (const tool of openllmTools) {
    const name = tool.name;
    addEntry(
      server,
      state,
      {
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        run: async (args) => {
          if (name === TRANSCRIPTION_TOOL_NAME) {
            if (transcribe === undefined)
              return errorResult(
                "Transcription requires a host-provided transcribe handler",
              );
            return transcribe(args, config);
          }
          const result = await handleOpenllmTool(name, args, config);
          return name === MODELS_TOOL_NAME
            ? prioritizeSubscriptionModels(result)
            : result;
        },
      },
      isMcpCoreTool(name),
    );
  }
  for (const tool of hostTools) {
    addEntry(
      server,
      state,
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations === undefined
          ? {}
          : { annotations: tool.annotations }),
        run: tool.run,
      },
      tool.listed,
    );
  }
  if (upstreams.length > 0) attachMarketplaceUpstreams(server, upstreams);
  else state.find.update({ description: findDescription(state) });
  return server;
};

/** Register marketplace proxy tools on a live server. Safe to call after
 *  listen — each `registerTool` notifies `tools/list_changed`. The Memory
 *  integration is listed (bar `whoAmI`); every other integration is found on demand. */
export const attachMarketplaceUpstreams = (
  server: McpServer,
  upstreams: readonly TUpstream[],
): void => {
  const state = lookupStates.get(server) ?? registerLookupTools(server);
  // A duplicate name or an unconvertible schema skips that one tool only —
  // a bad vendor manifest must never take the built-in tools down with it.
  const entries = upstreamToolEntries(upstreams, {
    alreadyRegistered: state.registered,
    onDuplicate: (name) =>
      console.warn(`[MCP] marketplace: skipping duplicate tool ${name}`),
  });
  for (const { name, upstream, tool } of entries) {
    try {
      // Validate the vendor schema up front, listed or deferred.
      fromJsonSchema<Record<string, unknown>>(tool.inputSchema);
      addEntry(
        server,
        state,
        {
          name,
          description: tool.description ?? `${upstream.id}: ${tool.name}`,
          inputSchema: tool.inputSchema,
          ...(tool.annotations === undefined
            ? {}
            : { annotations: tool.annotations as TToolAnnotations }),
          run: (args) => upstream.call(tool.name, args),
        },
        upstream.id === OPENLLM_MEMORY_ENTRY_ID &&
          !MEMORY_DEFERRED_TOOLS.has(tool.name),
      );
    } catch (err) {
      console.warn(
        `[MCP] marketplace: skipping ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  state.find.update({ description: findDescription(state) });
};

export type TLaunchConnected = {
  readonly upstreams: readonly TUpstream[];
};

export type TMarketplaceLoad = {
  readonly launchPromise: Promise<TMarketplaceLaunch>;
  readonly marketplacePromise: Promise<TLaunchConnected>;
};

export type TBeginMarketplaceLoadOptions = {
  readonly fetchLaunch?: (
    params: TMcpGatewayConfig,
  ) => Promise<TMarketplaceLaunch>;
  readonly connect?: (
    servers: readonly TMarketplaceLaunchServer[],
  ) => Promise<readonly TUpstream[]>;
  readonly clientVersion?: string;
  /** Group names that should trigger a launch fetch. */
  readonly groups: readonly string[];
};

/**
 * Filter launch servers for the requested MCP groups.
 * - both / default: every server
 * - `--only openllm-memory`: just the Memory marketplace entry
 * - `--only openllm`: every server except Memory
 */
export const filterLaunchServers = (
  servers: readonly TMarketplaceLaunchServer[],
  groups: readonly string[],
): readonly TMarketplaceLaunchServer[] => {
  const wantsOpenllm = groups.includes("openllm");
  const wantsMemory = groups.includes("openllm-memory");
  if (wantsMemory && !wantsOpenllm) {
    return servers.filter((s) => s.id === OPENLLM_MEMORY_ENTRY_ID);
  }
  if (wantsOpenllm && !wantsMemory) {
    return servers.filter((s) => s.id !== OPENLLM_MEMORY_ENTRY_ID);
  }
  return servers;
};

/**
 * Kick off `/api/marketplace/launch` whenever the `openllm` OR
 * `openllm-memory` group is requested, then dial the matching upstreams.
 */
export const beginMarketplaceLoad = (
  gateway: TMcpGatewayConfig,
  options: TBeginMarketplaceLoadOptions,
): TMarketplaceLoad => {
  const fetchLaunch =
    options.fetchLaunch ??
    ((cfg: TMcpGatewayConfig) =>
      fetchMarketplaceLaunch({
        cloudOrigin: cfg.baseUrl,
        apiKey: cfg.apiKey,
      }));
  const connect =
    options.connect ??
    ((servers: readonly TMarketplaceLaunchServer[]) =>
      connectUpstreams(servers, { clientVersion: options.clientVersion }));
  const requested = options.groups;
  const wantsLaunch =
    requested.includes("openllm") || requested.includes("openllm-memory");
  const emptyLaunch: TMarketplaceLaunch = { servers: [] };
  const launchPromise = wantsLaunch
    ? fetchLaunch(gateway)
    : Promise.resolve(emptyLaunch);
  const marketplacePromise: Promise<TLaunchConnected> = wantsLaunch
    ? launchPromise.then(async (launch) => ({
        upstreams: await connect(
          filterLaunchServers(launch.servers, requested),
        ),
      }))
    : Promise.resolve({ upstreams: [] as readonly TUpstream[] });
  return { launchPromise, marketplacePromise };
};

export { LAUNCH_TIMEOUT_MS };
