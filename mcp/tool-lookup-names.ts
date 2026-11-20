/**
 * Wire names of the two on-demand lookup tools (`./tool-lookup.ts`). Kept in
 * their own import-free module so a transcript display can name a routed
 * call without pulling in the operations table.
 */
export const OPENLLM_API_FIND_TOOL = "openllm_api_find";
export const OPENLLM_API_CALL_TOOL = "openllm_api_call";
