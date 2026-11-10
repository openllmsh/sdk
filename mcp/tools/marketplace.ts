/**
 * Marketplace integrations served THROUGH the one `openllm` MCP server.
 * Each enabled integration (`/api/marketplace/launch`) is dialled as an
 * upstream MCP server, and its tools are re-exported as `<id>__<tool>`.
 *
 * Dial transport is an injected {@link TMcpChannel}. The default is
 * Streamable HTTP / SSE for remote launch entries; hosts that can spawn
 * processes (the CLI) pass a stdio channel via `channel` / `channelFor`.
 * Without a channel, stdio entries are skipped — a browser never dials them.
 *
 * A minimal JSON-RPC client: initialize → tools/list → tools/call. Every
 * upstream fails open on its own — a dead vendor drops only its tools.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";
import { createClient } from "@openllmsh/sdk/client";
import {
  isMarketplaceLaunchServer,
  type TMarketplaceLaunchServer,
} from "@openllmsh/sdk/protocol";

export type { TMarketplaceLaunchServer };

export type TMarketplaceLaunch = {
  readonly servers: readonly TMarketplaceLaunchServer[];
};

export type TUpstreamTool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: Record<string, unknown>;
};

export type TUpstream = {
  readonly id: string;
  readonly tools: readonly TUpstreamTool[];
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
};

/** Injected JSON-RPC transport for one upstream MCP server. */
export type TMcpChannel = {
  readonly rpc: (
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly notify: (method: string) => Promise<void>;
  readonly close: () => Promise<void>;
};

const PROTOCOL_VERSION = "2025-06-18";
const MAX_TOOL_PAGES = 10;

/** Upstream MCP initialize / tools/list dial timeout. */
export const CONNECT_TIMEOUT_MS = 5_000;
/** Upstream MCP tools/call timeout. */
export const CALL_TIMEOUT_MS = 120_000;

/** Bound for `/api/marketplace/launch` and for the MCP factory wait on it. */
export const LAUNCH_TIMEOUT_MS = 5_000;

/** Separator between integration id and its tool name. */
export const UPSTREAM_TOOL_SEPARATOR = "__";

export const upstreamToolName = (id: string, tool: string): string =>
  `${id}${UPSTREAM_TOOL_SEPARATOR}${tool}`;

/** Reserved ids — an integration can never shadow the built-in server. */
const RESERVED = new Set(["openllm"]);

const EMPTY_LAUNCH: TMarketplaceLaunch = { servers: [] };

export type TFetchMarketplaceLaunchParams = {
  readonly cloudOrigin: string;
  readonly apiKey: string;
};

/**
 * The user's enabled marketplace integrations as ready upstream MCP servers
 * (`GET /api/marketplace/launch`). Fails open to none: a slow or older
 * gateway must never block the MCP server.
 */
export const fetchMarketplaceLaunch = async (
  params: TFetchMarketplaceLaunchParams,
): Promise<TMarketplaceLaunch> => {
  if (params.apiKey.length === 0) return EMPTY_LAUNCH;
  const client = createClient({
    origin: params.cloudOrigin,
    apiKey: params.apiKey,
    transport: {
      fetch: globalThis.fetch.bind(globalThis),
      websocket: WebSocket,
    },
  });
  try {
    const res = await client.http.call(
      "marketplace.launch",
      {},
      { timeoutMs: LAUNCH_TIMEOUT_MS },
    );
    if (!res.ok) return EMPTY_LAUNCH;
    const body =
      res.body !== null && typeof res.body === "object"
        ? (res.body as { servers?: unknown })
        : {};
    const servers = Array.isArray(body.servers)
      ? body.servers
          .filter(isMarketplaceLaunchServer)
          .filter((s) => !RESERVED.has(s.id))
      : [];
    return { servers };
  } catch {
    return EMPTY_LAUNCH;
  } finally {
    client.close();
  }
};

type TRpcMessage = {
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

const unwrap = (msg: TRpcMessage): unknown => {
  if (msg.error !== undefined)
    throw new Error(msg.error.message ?? "upstream error");
  return msg.result;
};

/** Pick the response for `id` out of an SSE body. */
const fromSse = (text: string, id: number): TRpcMessage | undefined => {
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (data.length === 0) continue;
    try {
      const msg = JSON.parse(data) as TRpcMessage;
      if (msg.id === id) return msg;
    } catch {
      // Not JSON — skip the event.
    }
  }
  return undefined;
};

/** Default Streamable HTTP / SSE channel for a remote launch entry. */
export const httpChannel = (server: TMarketplaceLaunchServer): TMcpChannel => {
  const url = server.url ?? "";
  let sessionId: string | undefined;
  let nextId = 0;
  const post = async (
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Response> => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...server.headers,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    sessionId = res.headers.get("mcp-session-id") ?? sessionId;
    return res;
  };
  const rpc: TMcpChannel["rpc"] = async (method, params = {}) => {
    const id = ++nextId;
    const timeout =
      method === "tools/call" ? CALL_TIMEOUT_MS : CONNECT_TIMEOUT_MS;
    const res = await post({ id, method, params }, timeout);
    const text = await res.text();
    let msg: TRpcMessage | undefined;
    try {
      msg = (res.headers.get("content-type") ?? "").includes(
        "text/event-stream",
      )
        ? fromSse(text, id)
        : (JSON.parse(text) as TRpcMessage);
    } catch {
      msg = undefined;
    }
    // A non-2xx without a JSON-RPC body reports the status, not a parse error.
    if (msg === undefined)
      throw new Error(
        res.ok ? "upstream sent no response" : `upstream HTTP ${res.status}`,
      );
    return unwrap(msg);
  };
  return {
    rpc,
    notify: async (method) => {
      await post({ method }, CONNECT_TIMEOUT_MS).then((r) => r.body?.cancel());
    },
    close: async () => {
      if (sessionId === undefined) return;
      await fetch(url, {
        method: "DELETE",
        headers: { ...server.headers, "mcp-session-id": sessionId },
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      }).catch(() => undefined);
    },
  };
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const toTool = (v: unknown): TUpstreamTool | undefined => {
  if (!isRecord(v) || typeof v.name !== "string") return undefined;
  return {
    name: v.name,
    ...(typeof v.description === "string"
      ? { description: v.description }
      : {}),
    inputSchema: isRecord(v.inputSchema)
      ? v.inputSchema
      : { type: "object", properties: {} },
    ...(isRecord(v.annotations) ? { annotations: v.annotations } : {}),
  };
};

const listTools = async (rpc: TMcpChannel["rpc"]): Promise<TUpstreamTool[]> => {
  const tools: TUpstreamTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const result = await rpc(
      "tools/list",
      cursor === undefined ? {} : { cursor },
    );
    if (!isRecord(result) || !Array.isArray(result.tools)) break;
    for (const raw of result.tools) {
      const tool = toTool(raw);
      if (tool !== undefined) tools.push(tool);
    }
    if (typeof result.nextCursor !== "string") break;
    cursor = result.nextCursor;
  }
  return tools;
};

const errorResult = (text: string): CallToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

const handshakeUpstream = async (
  server: TMarketplaceLaunchServer,
  channel: TMcpChannel,
  clientVersion: string,
): Promise<TUpstream> => {
  try {
    await channel.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "openllm", version: clientVersion },
    });
    await channel.notify("notifications/initialized");
    const blocked = new Set(server.blocked_tools ?? []);
    const tools = (await listTools(channel.rpc)).filter(
      (tool) => !blocked.has(tool.name),
    );
    return {
      id: server.id,
      tools,
      call: async (name, args) => {
        if (blocked.has(name))
          return errorResult(`${server.id}: ${name} is not available`);
        try {
          const result = await channel.rpc("tools/call", {
            name,
            arguments: args,
          });
          return isRecord(result) && Array.isArray(result.content)
            ? (result as CallToolResult)
            : errorResult(`${server.id}: malformed tool result`);
        } catch (err) {
          return errorResult(
            `${server.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
      close: channel.close,
    };
  } catch (err) {
    await channel.close();
    throw err;
  }
};

const defaultChannelFor = (
  server: TMarketplaceLaunchServer,
): TMcpChannel | undefined => {
  if (server.transport === "stdio") return undefined;
  if (server.url === undefined) return undefined;
  return httpChannel(server);
};

export type TConnectUpstreamOptions = {
  /** Client version string sent in MCP `initialize`. */
  readonly clientVersion?: string;
  /** Injected JSON-RPC channel. Defaults to HTTP/SSE for remote transports. */
  readonly channel?: TMcpChannel;
};

/** Dial one upstream over `channel` (or the default HTTP/SSE channel). */
export const connectUpstream = async (
  server: TMarketplaceLaunchServer,
  options: TConnectUpstreamOptions = {},
): Promise<TUpstream> => {
  const channel = options.channel ?? defaultChannelFor(server);
  if (channel === undefined) {
    if (server.transport === "stdio") {
      throw new Error(
        `${server.id}: stdio transport requires an injected channel`,
      );
    }
    throw new Error(`${server.id}: incomplete launch entry`);
  }
  return handshakeUpstream(
    server,
    channel,
    options.clientVersion ?? "0.0.0-dev",
  );
};

export type TConnectUpstreamsOptions = {
  readonly clientVersion?: string;
  /** Optional warning sink (defaults to `console.warn`). */
  readonly onWarn?: (message: string) => void;
  /**
   * Host-supplied channel for a server (e.g. Bun.spawn stdio). When omitted
   * for a stdio entry, that entry is skipped; remote entries still use HTTP.
   */
  readonly channelFor?: (
    server: TMarketplaceLaunchServer,
  ) => TMcpChannel | undefined;
};

/** Dial every upstream in parallel; failures are warned and dropped. */
export const connectUpstreams = async (
  servers: readonly TMarketplaceLaunchServer[],
  options: TConnectUpstreamsOptions = {},
): Promise<readonly TUpstream[]> => {
  const warn = options.onWarn ?? ((message: string) => console.warn(message));
  const dialable = servers.flatMap((server) => {
    // A host channel can throw synchronously (Bun.spawn on a missing
    // command): skip that one server, never the whole set.
    let channel: TMcpChannel | undefined;
    try {
      channel = options.channelFor?.(server) ?? defaultChannelFor(server);
    } catch (err) {
      warn(
        `[MCP] marketplace ${server.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
    if (channel === undefined) {
      warn(
        server.transport === "stdio"
          ? `[MCP] marketplace ${server.id}: skipping stdio transport (no channel)`
          : `[MCP] marketplace ${server.id}: incomplete launch entry`,
      );
      return [];
    }
    return [{ server, channel }];
  });
  const settled = await Promise.allSettled(
    dialable.map(({ server, channel }) =>
      handshakeUpstream(server, channel, options.clientVersion ?? "0.0.0-dev"),
    ),
  );
  const byId = new Map<string, TUpstream>();
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const id = dialable[i]?.server.id;
    if (r === undefined || id === undefined) continue;
    if (r.status === "fulfilled") {
      byId.set(id, r.value);
      continue;
    }
    warn(
      `[MCP] marketplace ${id}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
    );
  }
  // Preserve launch order.
  return servers.flatMap((server) => {
    const upstream = byId.get(server.id);
    return upstream === undefined ? [] : [upstream];
  });
};

export type TUpstreamToolEntry = {
  readonly name: string;
  readonly upstream: TUpstream;
  readonly tool: TUpstreamTool;
};

export type TUpstreamToolEntriesOptions = {
  readonly alreadyRegistered?: ReadonlySet<string>;
  /** Return false to drop a composed `<id>__<tool>` name (e.g. OpenAI regex). */
  readonly nameGuard?: (name: string) => boolean;
  readonly onDuplicate?: (name: string) => void;
};

/**
 * Deduped `<id>__<tool>` entries across marketplace upstreams. Shared by the
 * MCP server registration path and the browser chat function-tool surface.
 */
export const upstreamToolEntries = (
  upstreams: readonly TUpstream[],
  options: TUpstreamToolEntriesOptions = {},
): readonly TUpstreamToolEntry[] => {
  const registered = new Set(options.alreadyRegistered ?? []);
  const out: TUpstreamToolEntry[] = [];
  for (const upstream of upstreams) {
    for (const tool of upstream.tools) {
      const name = upstreamToolName(upstream.id, tool.name);
      if (options.nameGuard !== undefined && !options.nameGuard(name)) continue;
      if (registered.has(name)) {
        options.onDuplicate?.(name);
        continue;
      }
      registered.add(name);
      out.push({ name, upstream, tool });
    }
  }
  return out;
};
