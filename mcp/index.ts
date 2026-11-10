/**
 * Public `@openllmsh/sdk/mcp` surface — transport-free MCP tools + server.
 */

export {
  handleOpenllmTool,
  isFreeTierOnlyTool,
  isMcpListedTool,
  isMediaOptionalModelTool,
  isOpenllmTool,
  LOCAL_TRANSCRIPTION_TIMEOUT_MS,
  MAX_TRANSCRIPTION_BYTES,
  MODELS_TOOL_NAME,
  openllmToolDefs,
  openllmToolDefsAll,
  prioritizeSubscriptionModels,
  TRANSCRIPTION_TIMEOUT_MS,
  TRANSCRIPTION_TOOL_NAME,
  toolNameFor,
  uploadTranscription,
} from "./handle";
export type {
  TBeginMarketplaceLoadOptions,
  TCreateMcpServerOptions,
  TLaunchConnected,
  TMarketplaceLoad,
  TMcpGatewayConfig,
  TPermission,
} from "./server";
export {
  attachMarketplaceUpstreams,
  beginMarketplaceLoad,
  createMcpServer,
  filterLaunchServers,
  OPENLLM_MEMORY_BUILTIN_ID,
  OPENLLM_MEMORY_ENTRY_ID,
  parseKeyPermissions,
} from "./server";
export type {
  TConnectUpstreamOptions,
  TConnectUpstreamsOptions,
  TFetchMarketplaceLaunchParams,
  TMarketplaceLaunch,
  TMarketplaceLaunchServer,
  TMcpChannel,
  TUpstream,
  TUpstreamTool,
  TUpstreamToolEntriesOptions,
  TUpstreamToolEntry,
} from "./tools/marketplace";
export {
  CALL_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  connectUpstream,
  connectUpstreams,
  fetchMarketplaceLaunch,
  httpChannel,
  LAUNCH_TIMEOUT_MS,
  UPSTREAM_TOOL_SEPARATOR,
  upstreamToolEntries,
  upstreamToolName,
} from "./tools/marketplace";
export { handleMemoryTool, memoryToolDefs } from "./tools/memory";
export type {
  MatchedTeam,
  Memory,
  SaveOptions,
  SearchOptions,
  SearchResult,
  WhoamiResult,
} from "./tools/memory-client";
export { MemoryClient } from "./tools/memory-client";
export type { MemoryConfig, TProjectRef } from "./tools/memory-config";
export { COLLECTION_NAME } from "./tools/memory-config";
export type { TToolResult, TToolResultContent } from "./types";
export { toolResultText } from "./types";
