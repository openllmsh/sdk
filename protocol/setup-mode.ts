/**
 * Browser-safe product setup-mode contract (protocol SSOT).
 *
 * Shared by the CLI and the dashboard install one-liners. Pure constants +
 * parse — no Node, no env-file I/O.
 */

/** Env-file / process-env / install-one-liner key. */
export const SETUP_MODE_ENV = "OPENLLM_SETUP_MODE";

export const SETUP_MODES = ["full", "minimal"] as const;
export type TSetupMode = (typeof SETUP_MODES)[number];

/** Fresh-install / omitted-option default. */
export const DEFAULT_SETUP_MODE: TSetupMode = "full";

/** Accept only the documented values; reject anything else (incl. install/update). */
export const parseSetupMode = (raw: string | undefined): TSetupMode | null => {
  const value = raw?.trim();
  if (value === "full" || value === "minimal") return value;
  return null;
};
