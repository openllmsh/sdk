/**
 * Where a routing box marks itself. The box's user-data writes this file;
 * the daemon reads it to keep auto-update always on and to refuse device
 * sessions (a routing box is too small for them). Shared so the two sides
 * can't drift. Plan: docs/plans/routing-sandbox.md.
 */
export const ROUTING_BOX_MARKER_PATH = "/etc/openllm/routing-box";
