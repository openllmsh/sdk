/**
 * Re-export the native-API tool dispatcher for hosts that only need CallTool
 * handling without constructing a full MCP server.
 */

export {
  MODELS_TOOL_NAME,
  prioritizeSubscriptionModels,
} from "./tools/model-priority";
export {
  handleOpenllmTool,
  isFreeTierOnlyTool,
  isMcpListedTool,
  isMediaOptionalModelTool,
  isOpenllmTool,
  MAX_TRANSCRIPTION_BYTES,
  openllmToolDefs,
  openllmToolDefsAll,
  TRANSCRIPTION_TOOL_NAME,
  toolNameFor,
} from "./tools/openllm";
