/**
 * Pure registry-pointer identity validation — shared by the gateway
 * (`@openllm/registry` re-exports these) and the daemon's integration
 * executor. String-only: no crypto, fs, or fetch, so it stays inside the
 * daemon's protocol+wire dependency budget.
 */

export const REGISTRY_REPOSITORY = "openllmsh/registry";
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const FULL_COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
const INSTALL_STAMP_RE = /^# openllm-self-sha256: ([0-9a-f]{64})$/gm;

/** Read the one canonical install-stamp identity embedded in an assembled script. */
export const readRegistryInstallStampSha256 = (
  bytes: Uint8Array,
): string | null => {
  let script: string;
  try {
    script = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const matches = [...script.matchAll(INSTALL_STAMP_RE)];
  return matches.length === 1 ? matches[0][1] : null;
};

export type TRegistryPointerFilename = "install.sh" | "pointer.json";

export type TRegistryPointerLocation = {
  readonly commit: string;
  readonly area: "setup";
  readonly slug: string;
  readonly filename: TRegistryPointerFilename;
};

export const registryRawUrl = (
  commit: string,
  area: "setup",
  slug: string,
  filename: TRegistryPointerFilename,
): string => {
  if (!FULL_COMMIT_SHA_RE.test(commit)) {
    throw new Error(`registry commit must be a full lowercase SHA: ${commit}`);
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`invalid registry slug: ${slug}`);
  }
  return `https://raw.githubusercontent.com/${REGISTRY_REPOSITORY}/${commit}/${area}/${slug}/${filename}`;
};

export const validateRegistryRawUrl = (
  value: string,
  expected: {
    readonly area: "setup";
    readonly slug: string;
    readonly filename: TRegistryPointerFilename;
  },
): TRegistryPointerLocation => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("registry URL is malformed");
  }

  if (url.protocol !== "https:") throw new Error("registry URL must use HTTPS");
  if (url.hostname !== "raw.githubusercontent.com") {
    throw new Error("registry URL host is not approved");
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("registry URL contains forbidden authority or suffix data");
  }

  // Exact canonical layout: a leading empty segment then six non-empty parts.
  // No filter(Boolean) — duplicate or trailing slashes must be rejected, not
  // silently collapsed into a passing shape.
  const rawSegments = url.pathname.split("/");
  if (
    rawSegments.length !== 7 ||
    rawSegments[0] !== "" ||
    rawSegments.slice(1).some((segment) => segment === "")
  ) {
    throw new Error("registry URL path is invalid");
  }
  const [owner, repo, commit, area, slug, filename] = rawSegments.slice(1);
  if (`${owner}/${repo}` !== REGISTRY_REPOSITORY) {
    throw new Error("registry URL repository is not approved");
  }
  if (!FULL_COMMIT_SHA_RE.test(commit)) {
    throw new Error("registry URL must contain a full lowercase commit SHA");
  }
  if (
    area !== expected.area ||
    slug !== expected.slug ||
    filename !== expected.filename
  ) {
    throw new Error(
      "registry URL identity does not match the requested integration",
    );
  }
  const canonical = registryRawUrl(
    commit,
    expected.area,
    expected.slug,
    expected.filename,
  );
  if (value !== canonical) {
    throw new Error("registry URL is not canonical");
  }

  return { commit, area: expected.area, slug, filename: expected.filename };
};
