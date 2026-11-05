/**
 * Normalize user-turn text so a Device-tab bubble shows what the user typed,
 * not what the TUI echoed: bracketed-paste markers, CRs, Claude's
 * `<pasted_content>` wrapper, and trailing whitespace.
 *
 * Mid-line terminal soft-wraps are NOT joined here — an intentional
 * `line one\nline two` prompt must survive. Early wrapping in the Device tab
 * was a layout bug (`max-w-[80%]` under a shrink-wrapped `items-end` parent),
 * fixed on the bubble itself.
 */

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** Claude wraps a large paste as `<pasted_content id="…">…</pasted_content>`. */
const PASTED_CONTENT =
  /<pasted_content\b[^>]*>\r?\n?([\s\S]*?)\r?\n?<\/pasted_content\b[^>]*>/gi;
const WHOLE_PASTED_CONTENT =
  /^\s*<pasted_content\b[^>]*>\n?([\s\S]*?)\n?<\/pasted_content\b[^>]*>\s*$/i;

/**
 * Make echoed / transcript user-turn text equal what the user typed.
 * Idempotent: safe to run on already-clean composer input.
 */
export const normalizeUserPromptText = (raw: string): string => {
  let text = raw.replaceAll(PASTE_START, "").replaceAll(PASTE_END, "");
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const wholePaste = text.match(WHOLE_PASTED_CONTENT);
  text =
    wholePaste === null ? text.replace(PASTED_CONTENT, "$1") : wholePaste[1];
  return text.trimEnd();
};
