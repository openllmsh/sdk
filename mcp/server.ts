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

import type { TCatalogTool, TListedTool, TToolCatalog } from "./tool-catalog";
import {
  createToolCatalog,
  isListedOperation,
  upstreamCatalogTools,
} from "./tool-catalog";
import { OPENLLM_API_FIND_TOOL } from "./tool-lookup-names";
import type {
  TMarketplaceLaunch,
  TMarketplaceLaunchServer,
  TUpstream,
} from "./tools/marketplace";
import {
  connectUpstreams,
  fetchMarketplaceLaunch,
  LAUNCH_TIMEOUT_MS,
} from "./tools/marketplace";
import {
  MODELS_TOOL_NAME,
  prioritizeSubscriptionModels,
} from "./tools/model-priority";
import {
  handleOpenllmTool,
  isFreeTierOnlyTool,
  openllmAdminToolDefs,
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
  /** A gateway admin's key (`/api/user/tier` says so): the admin operations
   *  are added, found on demand. */
  readonly admin?: boolean;
  /** Host tools (e.g. the CLI's local-auth group), listed or deferred. */
  readonly hostTools?: readonly THostTool[];
};

/** A host-provided tool (e.g. the CLI's local-auth group). */
export type THostTool = TCatalogTool<TToolResult>;

const toolConfig = (
  tool: TListedTool,
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

const textResult = (text: string, isError: boolean): TToolResult => ({
  content: [{ type: "text", text }],
  ...(isError ? { isError: true } : {}),
});

/** Each server's catalog and its registered find tool (for late updates). */
const serverCatalogs = new WeakMap<
  McpServer,
  {
    readonly catalog: TToolCatalog<CallToolResult>;
    readonly find: RegisteredTool | undefined;
  }
>();

/** Register `tools` on `server`, each dispatched through `catalog`. */
const registerListed = (
  server: McpServer,
  catalog: TToolCatalog<CallToolResult>,
  tools: ReadonlyArray<TListedTool>,
): Map<string, RegisteredTool> => {
  const out = new Map<string, RegisteredTool>();
  for (const tool of tools) {
    out.set(
      tool.name,
      server.registerTool(
        tool.name,
        toolConfig(tool),
        (args: Record<string, unknown>): Promise<CallToolResult> =>
          catalog.call(tool.name, args) ??
          Promise.resolve(textResult(`Unknown tool: ${tool.name}`, true)),
      ),
    );
  }
  return out;
};

/**
 * One registration path for both negotiated stdio eras and local tests. The
 * listing is the shared tool catalog's (`./tool-catalog`): core tools and
 * host tools marked `listed`, compacted, plus the two lookup tools that
 * find and run everything else.
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
  admin = false,
}: TCreateMcpServerOptions): McpServer => {
  const held =
    permissions === undefined ? undefined : new Set<string>(permissions);
  const openllmTools: ReadonlyArray<TCatalogTool<CallToolResult>> =
    groups.includes("openllm")
      ? [...openllmToolDefs, ...(admin ? openllmAdminToolDefs : [])]
          .filter((tool) => {
            if (held !== undefined && !held.has(tool.permission)) return false;
            if (!includeFreeTierOnlyTools && isFreeTierOnlyTool(tool.name))
              return false;
            // Transcription needs a host-provided local-file handler.
            if (
              tool.name === TRANSCRIPTION_TOOL_NAME &&
              transcribe === undefined
            )
              return false;
            return true;
          })
          .map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            listed: isListedOperation(tool.name),
            run: async (args: Record<string, unknown>) => {
              if (tool.name === TRANSCRIPTION_TOOL_NAME && transcribe)
                return transcribe(args, config);
              const result = await handleOpenllmTool(tool.name, args, config);
              return tool.name === MODELS_TOOL_NAME
                ? prioritizeSubscriptionModels(result)
                : result;
            },
          }))
      : [];
  const catalog = createToolCatalog<CallToolResult>(
    [...openllmTools, ...hostTools],
    textResult,
  );
  const server = new McpServer(
    { name: "openllm", version },
    { capabilities: { tools: {} } },
  );
  const registered = registerListed(server, catalog, catalog.listed());
  serverCatalogs.set(server, {
    catalog,
    find: registered.get(OPENLLM_API_FIND_TOOL),
  });
  if (upstreams.length > 0) attachMarketplaceUpstreams(server, upstreams);
  return server;
};

/** Add marketplace integrations to a live server (safe after listen — each
 *  `registerTool` notifies `tools/list_changed`). Listed or found on demand
 *  per the shared catalog policy (`upstreamCatalogTools`). */
export const attachMarketplaceUpstreams = (
  server: McpServer,
  upstreams: readonly TUpstream[],
): void => {
  const entry = serverCatalogs.get(server);
  if (entry === undefined) return;
  const { catalog, find } = entry;
  // A duplicate name or an unconvertible schema skips that one tool only —
  // a bad vendor manifest must never take the built-in tools down with it.
  const tools = upstreamCatalogTools<CallToolResult>(
    upstreams,
    (upstream, toolName, args) => upstream.call(toolName, args),
    {
      alreadyRegistered: catalog.names(),
      onDuplicate: (name) =>
        console.warn(`[MCP] marketplace: skipping duplicate tool ${name}`),
    },
  ).filter((tool) => {
    try {
      fromJsonSchema<Record<string, unknown>>(tool.inputSchema);
      return true;
    } catch (err) {
      console.warn(
        `[MCP] marketplace: skipping ${tool.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  });
  registerListed(server, catalog, catalog.add(tools));
  const findSpec = catalog
    .listed()
    .find((tool) => tool.name === OPENLLM_API_FIND_TOOL);
  if (findSpec !== undefined)
    find?.update({ description: findSpec.description });
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
