/**
 * Compile `@openllmsh/sdk` for npm, so it runs on plain Node and not only on
 * Bun or behind a bundler.
 *
 * Runs ONLY in the public mirror's npm publish workflow
 * (`.github/workflows/npm-publish.yml`), on a throwaway checkout. The monorepo,
 * the `openllm` binary and `github:` installs keep importing the TypeScript
 * source; nothing here runs in the monorepo's build.
 *
 *   1. `tsc -p tsconfig.build.json` emits `dist/` — one `.js` + `.d.ts` per
 *      source file (the wildcard subpaths let a consumer import any file).
 *   2. Relative specifiers are made Node-resolvable: `./x` → `./x.js` or
 *      `./x/index.js`, matching the source file that exists.
 *   3. JSON imports gain `with { type: "json" }` (Node requires it).
 *   4. `package.json` `exports` are rewritten to `{ types, default }` pairs in
 *      `dist/`, and `files` limits the tarball to `dist/` + licenses + docs.
 *
 * Usage: bun scripts/build-npm.ts [--tsc <command>]
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { $ } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

type TExports = Record<string, string>;
type TConditionalExport = { readonly types?: string; readonly default: string };

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** The `.js` specifier Node needs for a relative import written in `fromDir`
 *  of the SOURCE tree. Specifiers that already carry an extension, and ones
 *  that resolve to nothing, are left as they are. */
export const nodeSpecifier = (fromDir: string, spec: string): string => {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return spec;
  if (/\.(js|mjs|cjs|json)$/.test(spec)) return spec;
  const target = resolve(fromDir, spec);
  if (existsSync(`${target}.ts`)) return `${spec}.js`;
  if (existsSync(join(target, "index.ts")))
    return `${spec.replace(/\/$/, "")}/index.js`;
  return spec;
};

const SPECIFIER =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bexport\s*\*\s*from\s*)(["'])([^"']+)\2/g;

/** Rewrite one emitted file's specifiers, resolved against its source dir. */
export const rewriteEmitted = (text: string, sourceDir: string): string =>
  text
    .replace(SPECIFIER, (all, lead: string, quote: string, spec: string) => {
      const next = nodeSpecifier(sourceDir, spec);
      return next === spec ? all : `${lead}${quote}${next}${quote}`;
    })
    // Node refuses a JSON import without the attribute.
    .replace(
      /(import\s+[\w$]+\s+from\s*(["'])[^"']+\.json\2)(?!\s*with)/g,
      '$1 with { type: "json" }',
    );

/** `./wire/index.ts` → `./dist/wire/index.js` (and `.d.ts` for types);
 *  JSON maps straight into `dist/`. */
export const distExports = (
  exports: TExports,
): Record<string, TConditionalExport> =>
  Object.fromEntries(
    Object.entries(exports).map(([key, target]) => {
      const inDist = target.replace(/^\.\//, "./dist/");
      if (target.endsWith(".json")) return [key, { default: inDist }];
      return [
        key,
        {
          types: inDist.replace(/\.ts$/, ".d.ts"),
          default: inDist.replace(/\.ts$/, ".js"),
        },
      ];
    }),
  );

const main = async (): Promise<void> => {
  const tscFlag = process.argv.indexOf("--tsc");
  const tsc = tscFlag === -1 ? "tsc" : (process.argv[tscFlag + 1] ?? "tsc");

  await $`rm -rf ${DIST}`;
  await $`${{ raw: tsc }} -p ${join(ROOT, "tsconfig.build.json")}`.cwd(ROOT);

  for (const file of walk(DIST)) {
    if (!/\.(js|d\.ts)$/.test(file)) continue;
    const sourceDir = dirname(join(ROOT, relative(DIST, file)));
    const text = readFileSync(file, "utf8");
    const next = rewriteEmitted(text, sourceDir);
    if (next !== text) writeFileSync(file, next);
  }

  // JSON the package exports must exist in dist even if nothing imports it.
  const pkgPath = join(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  for (const target of Object.values(pkg.exports as TExports)) {
    if (!target.endsWith(".json")) continue;
    const to = join(DIST, target);
    if (!existsSync(to))
      await $`mkdir -p ${dirname(to)} && cp ${join(ROOT, target)} ${to}`;
  }

  pkg.exports = distExports(pkg.exports as TExports);
  pkg.files = [
    "dist",
    "LICENSE",
    "wire/LICENSE",
    "tunnel/LICENSE",
    "vault/LICENSE",
    "README.md",
    "assets",
  ];
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`built ${walk(DIST).length} files into dist/`);
};

if (import.meta.main) await main();
