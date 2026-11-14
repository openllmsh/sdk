/**
 * Where a Routebox marks itself. The box's user-data writes this file;
 * the daemon reads it to keep auto-update always on and to refuse device
 * sessions (a Routebox is too small for them). Shared so the two sides
 * can't drift. Plan: docs/plans/routebox.md.
 */
export const ROUTEBOX_MARKER_PATH = "/etc/openllm/routebox";
