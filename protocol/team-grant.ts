/**
 * Team-grant wire constants. A leaf module (no imports) so `relay`, `mux`
 * and `daemon` can all bound the grant without an import cycle.
 */

/** Soft wire cap for an origin-signed team grant on `channel_open` / tunnel OPEN. */
export const TEAM_GRANT_B64_MAX = 4 * 1024;

/** Maximum lifetime of a direct daemon-to-daemon team inference stream. */
export const TEAM_LEG_STREAM_DEADLINE_MS = 800 * 1000;

/**
 * Request / tunnel-OPEN carrier for a team grant the serving daemon re-checks
 * (model, local cap, kill switch). The relay admits on `channel_open.team_grant`
 * only; this header is defence-in-depth on the request path.
 */
export const TEAM_GRANT_HEADER = "x-openllm-team-grant";
