/**
 * Transport-free MCP server factory for OpenLLM.
 *
 * Hosts (CLI `openllm mcp`, browser chat, external runtimes) inject version,
 * already-resolved groups, gateway credentials, and optional handlers. This
 * module never touches stdio, CLI onboarding, or local-auth tools.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
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
  isMcpListedTool,
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
};

/** One registration path for both negotiated stdio eras and local tests. */
export const createMcpServer = ({
  version,
  groups,
  config,
  upstreams = [],
  includeFreeTierOnlyTools = false,
  transcribe,
  permissions,
}: TCreateMcpServerOptions): McpServer => {
  const held =
    permissions === undefined ? undefined : new Set<string>(permissions);
  const mayCall = (name: string): boolean => {
    if (held === undefined) return true;
    const def = openllmToolDefs.find((tool) => tool.name === name);
    return def !== undefined && held.has(def.permission);
  };
  const openllmTools = openllmToolDefs.filter((tool) => {
    if (!mayCall(tool.name)) return false;
    if (!includeFreeTierOnlyTools && isFreeTierOnlyTool(tool.name))
      return false;
    // Transcription needs a host-provided local-file handler.
    if (tool.name === TRANSCRIPTION_TOOL_NAME && transcribe === undefined)
      return false;
    return true;
  });
  const tools = [...(groups.includes("openllm") ? openllmTools : [])];
  const server = new McpServer(
    { name: "openllm", version },
    { capabilities: { tools: {} } },
  );
  for (const tool of tools) {
    const name = tool.name;
    const inputSchema: Record<string, unknown> = tool.inputSchema;
    // MCP server overloads accept either Zod shapes or StandardSchemaV1;
    // `fromJsonSchema` returns the latter. Cast through unknown to the
    // registerTool config slot so we don't depend on a Zod-shaped overload.
    const toolConfig = {
      description: tool.description,
      ...("annotations" in tool && tool.annotations !== undefined
        ? {
            annotations: tool.annotations as {
              readonly title?: string;
              readonly readOnlyHint?: boolean;
              readonly destructiveHint?: boolean;
              readonly idempotentHint?: boolean;
              readonly openWorldHint?: boolean;
            },
          }
        : {}),
      inputSchema: fromJsonSchema<Record<string, unknown>>(inputSchema),
    };
    server.registerTool(
      name,
      toolConfig as unknown as Parameters<McpServer["registerTool"]>[1],
      async (args: Record<string, unknown>): Promise<TToolResult> => {
        if (
          groups.includes("openllm") &&
          isMcpListedTool(name) &&
          mayCall(name) &&
          (includeFreeTierOnlyTools || !isFreeTierOnlyTool(name))
        ) {
          if (name === TRANSCRIPTION_TOOL_NAME) {
            if (transcribe === undefined) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Transcription requires a host-provided transcribe handler",
                  },
                ],
                isError: true,
              };
            }
            return transcribe(args, config);
          }
          const result = await handleOpenllmTool(name, args, config);
          return name === MODELS_TOOL_NAME
            ? prioritizeSubscriptionModels(result)
            : result;
        }
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
      },
    );
  }
  if (upstreams.length > 0) {
    attachMarketplaceUpstreams(
      server,
      upstreams,
      new Set(tools.map((tool) => tool.name)),
    );
  }
  return server;
};

/** Register marketplace proxy tools on a live server. Safe to call after
 *  listen — each `registerTool` notifies `tools/list_changed`. */
export const attachMarketplaceUpstreams = (
  server: McpServer,
  upstreams: readonly TUpstream[],
  alreadyRegistered: ReadonlySet<string> = new Set(),
): void => {
  // A duplicate name or an unconvertible schema skips that one tool only —
  // a bad vendor manifest must never take the built-in tools down with it.
  const entries = upstreamToolEntries(upstreams, {
    alreadyRegistered,
    onDuplicate: (name) =>
      console.warn(`[MCP] marketplace: skipping duplicate tool ${name}`),
  });
  for (const { name, upstream, tool } of entries) {
    try {
      const upstreamConfig = {
        ...(tool.description === undefined
          ? {}
          : { description: tool.description }),
        ...(tool.annotations === undefined
          ? {}
          : {
              annotations: tool.annotations as {
                readonly title?: string;
                readonly readOnlyHint?: boolean;
                readonly destructiveHint?: boolean;
                readonly idempotentHint?: boolean;
                readonly openWorldHint?: boolean;
              },
            }),
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema),
      };
      server.registerTool(
        name,
        upstreamConfig as unknown as Parameters<McpServer["registerTool"]>[1],
        (args: Record<string, unknown>): Promise<CallToolResult> =>
          upstream.call(tool.name, args),
      );
    } catch (err) {
      console.warn(
        `[MCP] marketplace: skipping ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
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
