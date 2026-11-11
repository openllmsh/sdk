/**
 * Prove a packed `@openllmsh/sdk` tarball works on plain Node BEFORE it is
 * published: install it into an empty ESM project and import every non-wildcard
 * subpath (plus a few deep wildcard files), then run a vault round-trip.
 *
 * Runs with plain Node (24 strips the types of a file outside node_modules) —
 * the point is to exercise Node's own resolver, not Bun's.
 *
 * Usage: node scripts/smoke-npm.ts <path-to-tarball.tgz>
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DEEP_FILES = [
  "./protocol/chat",
  "./tunnel/codec",
  "./vault/crypto",
  "./wire/lib/streaming/sse",
] as const;

const tarball = process.argv[2];
if (tarball === undefined) {
  console.error("usage: node scripts/smoke-npm.ts <tarball.tgz>");
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "sdk-smoke-"));
writeFileSync(
  join(dir, "package.json"),
  JSON.stringify({ name: "sdk-smoke", private: true, type: "module" }),
);
execFileSync("npm", ["install", "--no-audit", "--no-fund", resolve(tarball)], {
  cwd: dir,
  stdio: "inherit",
});

const manifest: { exports: Record<string, unknown> } = JSON.parse(
  readFileSync(join(dir, "node_modules/@openllmsh/sdk/package.json"), "utf8"),
);
const subpaths = [
  ...Object.keys(manifest.exports).filter((key) => !key.includes("*")),
  ...DEEP_FILES,
];

const probe = `
const subpaths = ${JSON.stringify(subpaths)};
let failed = 0;
for (const subpath of subpaths) {
  const spec = "@openllmsh/sdk" + subpath.slice(1);
  try {
    const mod = subpath.endsWith(".json")
      ? await import(spec, { with: { type: "json" } })
      : await import(spec);
    console.log("ok  ", subpath, Object.keys(mod).length);
  } catch (error) {
    failed++;
    console.log("FAIL", subpath, String(error?.message ?? error).split("\\n")[0]);
  }
}
const { aesGcmEncrypt, aesGcmDecrypt } = await import("@openllmsh/sdk/vault");
const key = crypto.getRandomValues(new Uint8Array(32));
const iv = crypto.getRandomValues(new Uint8Array(12));
const text = "openllm sdk smoke";
const ct = await aesGcmEncrypt(key, iv, new TextEncoder().encode(text));
const back = new TextDecoder().decode(await aesGcmDecrypt(key, iv, ct));
if (back !== text) { failed++; console.log("FAIL vault round-trip"); }
else console.log("ok   vault round-trip");
process.exit(failed === 0 ? 0 : 1);
`;
writeFileSync(join(dir, "probe.mjs"), probe);
execFileSync("node", ["probe.mjs"], { cwd: dir, stdio: "inherit" });
console.log(
  `smoke passed: ${subpaths.length} subpaths on Node ${process.version}`,
);
