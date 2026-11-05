/** Parse a daemon port from an env-file compatible scalar. */
export const parseOpenllmDaemonPort = (
  raw: string,
  fallback: number,
): number => {
  const trimmed = raw.trim();
  const wrapped = (s: string, q: string): boolean =>
    s.length >= 2 && s.startsWith(q) && s.endsWith(q);
  const deComment = (s: string): string =>
    s.replace(/^(.*)\s#.*$/, "$1").trim();
  // Order depends on WHERE the comment sits relative to the quotes:
  //   "59321 # local"  → comment INSIDE quotes → unwrap first, then de-comment
  //   "59321" # local  → comment OUTSIDE quotes → de-comment first, then unwrap
  //   59321 # local    → bare value with a trailing comment
  let value: string;
  if (wrapped(trimmed, '"') || wrapped(trimmed, "'")) {
    value = deComment(trimmed.slice(1, -1));
  } else {
    const decommented = deComment(trimmed);
    value =
      wrapped(decommented, '"') || wrapped(decommented, "'")
        ? decommented.slice(1, -1)
        : decommented;
  }
  const stripped = value.trim();
  if (!/^\d+$/.test(stripped)) return fallback;
  const parsed = Number.parseInt(stripped, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535
    ? parsed
    : fallback;
};
