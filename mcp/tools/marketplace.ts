/**
 * Marketplace integrations served THROUGH the one `openllm` MCP server.
 * Each enabled integration (`/api/marketplace/launch`) is dialled as an
 * upstream MCP server over Streamable HTTP / SSE only, and its tools are
 * re-exported as `<id>__<tool>`. Stdio launch entries are skipped — hosts
 * that need package entries must dial them outside this SDK module.
 *
 * A minimal JSON-RPC client: initialize → tools/list → tools/call. Every
 * upstream fails open on its own — a dead vendor drops only its tools.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";

/** One resolved MCP server from `/api/marketplace/launch`. */
export type TMarketplaceLaunchServer = {
  readonly id: string;
  readonly transport: "http" | "sse" | "stdio";
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  /** Upstream tools never exposed — account-owner operations. */
  readonly blocked_tools?: readonly string[];
};

export type TMarketplaceLaunch = {
  readonly servers: readonly TMarketplaceLaunchServer[];
  /** Enabled first-party builtins (e.g. `"openllm-memory"`). */
  readonly builtins: readonly string[];
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

type TRpc = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;
type TNotify = (method: string) => Promise<void>;
type TChannel = {
  readonly rpc: TRpc;
  readonly notify: TNotify;
  readonly close: () => Promise<void>;
};

const PROTOCOL_VERSION = "2025-06-18";
const CONNECT_TIMEOUT_MS = 5_000;
const CALL_TIMEOUT_MS = 120_000;
const MAX_TOOL_PAGES = 10;

/** Bound for `/api/marketplace/launch` and for the MCP factory wait on it. */
export const LAUNCH_TIMEOUT_MS = 5_000;

/** Separator between integration id and its tool name. */
export const UPSTREAM_TOOL_SEPARATOR = "__";

export const upstreamToolName = (id: string, tool: string): string =>
  `${id}${UPSTREAM_TOOL_SEPARATOR}${tool}`;

/** Reserved ids — an integration can never shadow the built-in server. */
const RESERVED = new Set(["openllm"]);

const EMPTY_LAUNCH: TMarketplaceLaunch = { servers: [], builtins: [] };

const isStringRecord = (v: unknown): v is Record<string, string> =>
  v !== null &&
  typeof v === "object" &&
  Object.values(v).every((x) => typeof x === "string");

const isLaunchServer = (v: unknown): v is TMarketplaceLaunchServer => {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    /^[a-z][a-z0-9-]{1,47}$/.test(s.id) &&
    (s.transport === "http" ||
      s.transport === "sse" ||
      s.transport === "stdio") &&
    (s.url === undefined || typeof s.url === "string") &&
    (s.headers === undefined || isStringRecord(s.headers)) &&
    (s.command === undefined || typeof s.command === "string") &&
    (s.args === undefined ||
      (Array.isArray(s.args) && s.args.every((a) => typeof a === "string"))) &&
    (s.env === undefined || isStringRecord(s.env)) &&
    (s.blocked_tools === undefined ||
      (Array.isArray(s.blocked_tools) &&
        s.blocked_tools.every((t) => typeof t === "string")))
  );
};

export type TFetchMarketplaceLaunchParams = {
  readonly cloudOrigin: string;
  readonly apiKey: string;
};

/**
 * The user's enabled marketplace integrations as ready upstream MCP servers
 * plus first-party builtins (`GET /api/marketplace/launch`). Fails open to
 * none: a slow or older gateway must never block the MCP server.
 */
export const fetchMarketplaceLaunch = async (
  params: TFetchMarketplaceLaunchParams,
): Promise<TMarketplaceLaunch> => {
  if (params.apiKey.length === 0) return EMPTY_LAUNCH;
  try {
    const res = await fetch(
      `${params.cloudOrigin.replace(/\/$/, "")}/api/marketplace/launch`,
      {
        headers: { authorization: `Bearer ${params.apiKey}` },
        signal: AbortSignal.timeout(LAUNCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return EMPTY_LAUNCH;
    const body = (await res.json()) as {
      servers?: unknown;
      builtins?: unknown;
    };
    const servers = Array.isArray(body.servers)
      ? body.servers.filter(isLaunchServer).filter((s) => !RESERVED.has(s.id))
      : [];
    const builtins = Array.isArray(body.builtins)
      ? body.builtins.filter(
          (id): id is string =>
            typeof id === "string" &&
            /^[a-z][a-z0-9-]{1,47}$/.test(id) &&
            !RESERVED.has(id),
        )
      : [];
    return { servers, builtins };
  } catch {
    return EMPTY_LAUNCH;
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

const httpChannel = (server: TMarketplaceLaunchServer): TChannel => {
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
  const rpc: TRpc = async (method, params = {}) => {
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

const listTools = async (rpc: TRpc): Promise<TUpstreamTool[]> => {
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

export type TConnectUpstreamOptions = {
  /** Client version string sent in MCP `initialize`. */
  readonly clientVersion?: string;
};

/** Dial one HTTP/SSE upstream; rejects stdio and any handshake failure. */
export const connectUpstream = async (
  server: TMarketplaceLaunchServer,
  options: TConnectUpstreamOptions = {},
): Promise<TUpstream> => {
  if (server.transport === "stdio") {
    throw new Error(
      `${server.id}: stdio transport is not supported in sdk/mcp`,
    );
  }
  if (server.url === undefined)
    throw new Error(`${server.id}: incomplete launch entry`);
  const channel = httpChannel(server);
  const clientVersion = options.clientVersion ?? "0.0.0-dev";
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

export type TConnectUpstreamsOptions = {
  readonly clientVersion?: string;
  /** Optional warning sink (defaults to `console.warn`). */
  readonly onWarn?: (message: string) => void;
};

/** Dial every HTTP/SSE upstream in parallel; stdio + failures are skipped. */
export const connectUpstreams = async (
  servers: readonly TMarketplaceLaunchServer[],
  options: TConnectUpstreamsOptions = {},
): Promise<readonly TUpstream[]> => {
  const warn = options.onWarn ?? ((message: string) => console.warn(message));
  const remote = servers.filter((server) => {
    if (server.transport !== "stdio") return true;
    warn(
      `[MCP] marketplace ${server.id}: skipping stdio transport (not supported in sdk/mcp)`,
    );
    return false;
  });
  const settled = await Promise.allSettled(
    remote.map((server) =>
      connectUpstream(server, { clientVersion: options.clientVersion }),
    ),
  );
  return settled.flatMap((r, i) => {
    if (r.status === "fulfilled") return [r.value];
    warn(
      `[MCP] marketplace ${remote[i]?.id}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
    );
    return [];
  });
};
