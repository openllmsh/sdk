/**
 * memory integration config.
 *
 * Embedding happens entirely on the gateway (host-paid Bedrock Titan v2
 * at 1024-d, fixed). The bundle ships raw text to
 * `/api/integrations/memory/{save,forget,search}` and never touches an
 * embedding endpoint — keeps the host model off the public surface.
 *
 * Project identity is injected by the host (CLI/browser). This module never
 * reads `process.cwd()` or shells out to git.
 */

export const COLLECTION_NAME = "memories";

export type TProjectRef = {
  readonly slug: string;
  readonly remote_owner?: string;
  readonly remote_repo?: string;
};

export interface MemoryConfig {
  name: string;
  version: string;
  gatewayUrl: string;
  gatewayApiKey: string;
  /** Working directory used only when `resolveProject` is not provided. */
  cwd?: string;
  /** Resolve a project slug (optional override → slug). */
  resolveProject?: (override?: string) => string;
  /** Build the project_ref sent with save/search. */
  buildProjectRef?: (projectSlug: string) => TProjectRef;
}
