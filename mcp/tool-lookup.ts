/**
 * The on-demand tool surface shared by every OpenLLM tool host (the
 * `openllm mcp` server and the browser chat).
 *
 * Every listed tool's schema is part of an agent's prompt on every request,
 * so a host lists only the tools a conversation uses ({@link isCoreTool}) and
 * puts everything else — account reads, local-auth management, marketplace
 * integrations — behind two small tools:
 *
 *  - {@link OPENLLM_API_FIND_TOOL} searches the deferred tools by keyword and
 *    returns their full schemas (and the full schema of a listed tool whose
 *    description was shortened);
 *  - {@link OPENLLM_API_CALL_TOOL} runs one by name.
 *
 * Listed schemas are shortened deterministically ({@link compactToolSchema}):
 * long descriptions are cut at a word boundary, nothing structural changes,
 * so a call built from the short schema is exactly as valid and the bytes
 * never move the prompt-cache prefix by themselves.
 */

import {
  OPENLLM_API_CALL_TOOL,
  OPENLLM_API_FIND_TOOL,
} from "./tool-lookup-names";

export { OPENLLM_API_CALL_TOOL, OPENLLM_API_FIND_TOOL };

/** Native-API operation groups listed as tools; every other group is found
 *  on demand. */
const CORE_OPERATION_GROUPS: ReadonlySet<string> = new Set([
  "v1Audio",
  "v1ChatCompletions",
  "v1Embeddings",
  "v1Images",
  "v1Messages",
  "v1Models",
  "v1Responses",
  "v1Search",
  "v1Videos",
  "memory",
  "media",
  "providerModels",
  "gravity",
]);

/** `api_<group>_<action>` → `<group>`; `<upstream>__<tool>` → `<upstream>`. */
export const toolGroupOf = (name: string): string => {
  const upstream = name.indexOf("__");
  if (upstream > 0) return name.slice(0, upstream);
  return name.replace(/^api_/, "").split("_")[0] ?? name;
};

/** True for a native-API operation in a core group (the catalog lists
 *  these, bar a few follow-ups — `isListedOperation` in `./tool-catalog`). */
export const isCoreTool = (name: string): boolean =>
  CORE_OPERATION_GROUPS.has(toolGroupOf(name));

/** Gateway-admin operations (`requireAdmin`): offered to admins only. */
const ADMIN_PATH = /^\/(admin|stats\/admin)(\/|$)/;

/** True for an operation path only a gateway admin may call. */
export const isAdminOperationPath = (path: string): boolean =>
  ADMIN_PATH.test(path);

export type TLookupEntry = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
};

/** At most this many tools come back from one keyword search. */
const FIND_LIMIT = 20;
/** A search result's summary is cut past this many characters. */
const SUMMARY_MAX = 160;

/** The name and a short summary: what a search returns, never a schema. */
const summaryOf = (
  entry: TLookupEntry,
): { readonly name: string; readonly summary: string } => ({
  name: entry.name,
  summary: cutText(
    entry.description.replace(/\s+/g, " ").trim(),
    SUMMARY_MAX,
    "",
  ).trimEnd(),
});

/**
 * {@link OPENLLM_API_FIND_TOOL}'s result over `entries`. Searching is cheap:
 * an empty query lists every tool and a keyword query the matching ones,
 * best first, each as a name and a short summary only. Asking for an exact
 * name returns that one tool's full, untruncated description and input
 * schema — the only answer that carries a schema, so a lookup never pours
 * every matching vendor schema into the context.
 */
export const findLookupEntries = (
  entries: ReadonlyArray<TLookupEntry>,
  query: string,
): string => {
  const exact = entries.find((entry) => entry.name === query.trim());
  if (exact !== undefined) {
    return JSON.stringify({
      tools: [
        {
          name: exact.name,
          description: exact.description,
          parameters: exact.inputSchema,
        },
      ],
    });
  }
  if (query.trim() === "") {
    return JSON.stringify({ tools: entries.map(summaryOf) });
  }
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
  const scored = entries
    .map((entry) => {
      const name = entry.name.toLowerCase();
      const text = `${name} ${entry.description.toLowerCase()}`;
      const hits = words.filter((w) => text.includes(w));
      // Every word must appear somewhere; name hits rank above description.
      return words.length === 0 || hits.length < words.length
        ? null
        : { entry, score: words.filter((w) => name.includes(w)).length };
    })
    .filter((hit) => hit !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, FIND_LIMIT);
  return JSON.stringify({
    tools: scored.map(({ entry }) => summaryOf(entry)),
    hint:
      scored.length === 0
        ? "No tool matches every word. Try fewer words, or an empty query to list them all."
        : "Pass one exact name as the query to get its full description and input schema.",
  });
};

/**
 * The tool and its arguments for {@link OPENLLM_API_CALL_TOOL}, or an error
 * to hand the model. `callable` decides which names it may run.
 */
export const parseLookupCall = (
  args: Record<string, unknown>,
  callable: (name: string) => boolean,
):
  | {
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    }
  | { readonly error: string } => {
  const name = args.name;
  if (typeof name !== "string" || !callable(name)) {
    return {
      error: `Error: unknown tool ${JSON.stringify(name)}. Find one with ${OPENLLM_API_FIND_TOOL} first; listed tools are called directly.`,
    };
  }
  const inner = args.arguments === undefined ? {} : args.arguments;
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
    return { error: "Error: `arguments` must be an object" };
  }
  return { name, arguments: inner as Record<string, unknown> };
};

/** Deferred groups, in first-seen order, for the find tool's description. */
export const lookupGroups = (
  entries: ReadonlyArray<TLookupEntry>,
): ReadonlyArray<string> => [
  ...new Set(entries.map((entry) => toolGroupOf(entry.name))),
];

/** The two lookup tools, as `{ name, description, inputSchema }`. */
export const lookupToolSpecs = (
  groups: ReadonlyArray<string>,
): ReadonlyArray<TLookupEntry> => [
  {
    name: OPENLLM_API_FIND_TOOL,
    description: `Find OpenLLM tools that are not listed (groups: ${groups.join(", ")}): account reads, local sign-in management and integrations. An empty query lists every tool and a keyword query the matching ones, each as a name and short summary. Pass one exact name to get its full description and input schema, then run it with ${OPENLLM_API_CALL_TOOL} (a listed tool whose description was shortened is still called directly).`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Keywords or an exact tool name, e.g. "team list", "usage stats", "web scrape".',
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: OPENLLM_API_CALL_TOOL,
    description: `Run one unlisted tool found with ${OPENLLM_API_FIND_TOOL}, by its exact name, with arguments matching its input schema. Listed tools are called directly, not through this.`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: `Tool name from ${OPENLLM_API_FIND_TOOL}, e.g. "api_teams_list".`,
        },
        arguments: {
          type: "object",
          description: "Arguments for the tool, per its input schema.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
];

// ─── Schema compaction ─────────────────────────────────────────────────

/** A tool's own description is cut past this many characters. */
export const TOOL_DESCRIPTION_MAX = 400;
/** A parameter description is cut past this many characters. */
export const PARAM_DESCRIPTION_MAX = 160;

/** How far a compaction cuts: a tool's own description, then each
 *  parameter's. */
export type TCompactionLimits = {
  readonly tool: number;
  readonly param: number;
};

const DEFAULT_LIMITS: TCompactionLimits = {
  tool: TOOL_DESCRIPTION_MAX,
  param: PARAM_DESCRIPTION_MAX,
};

/** Keys whose values are data, not schema: never rewritten. */
const DATA_KEYS: ReadonlySet<string> = new Set([
  "enum",
  "const",
  "default",
  "examples",
  "example",
]);

/** Keywords whose value maps NAMES (any string, `default` or `__proto__`
 *  included) to schemas — never schema keywords themselves. */
const SCHEMA_MAP_KEYS: ReadonlySet<string> = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
  // draft-07: property name → schema (or, untouched, an array of names).
  "dependencies",
]);

/** `text` cut to at most `max` chars at a word boundary, with `marker`. */
export const cutText = (text: string, max: number, marker: string): string => {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const space = head.lastIndexOf(" ");
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}… ${marker}`;
};

type TCompacted = { readonly schema: unknown; readonly shortened: boolean };

/** Sets `key` as an own property — `out.__proto__ = …` would instead hit the
 *  inherited setter and drop the entry. */
const setOwn = (
  out: Record<string, unknown>,
  key: string,
  value: unknown,
): void => {
  Object.defineProperty(out, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
};

/** A name → schema map, each entry compacted as a schema. */
const compactSchemaMap = (value: unknown, max: number): TCompacted => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return compactSchema(value, max);
  }
  let shortened = false;
  const out: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(value)) {
    const next = compactSchema(child, max);
    shortened ||= next.shortened;
    setOwn(out, name, next.schema);
  }
  return { schema: out, shortened };
};

/** A schema with every long `description` shortened; tells whether any was. */
export const compactSchema = (
  value: unknown,
  max: number = PARAM_DESCRIPTION_MAX,
): TCompacted => {
  if (Array.isArray(value)) {
    let shortened = false;
    const schema = value.map((item) => {
      const next = compactSchema(item, max);
      shortened ||= next.shortened;
      return next.schema;
    });
    return { schema, shortened };
  }
  if (typeof value !== "object" || value === null) {
    return { schema: value, shortened: false };
  }
  let shortened = false;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (DATA_KEYS.has(key)) {
      setOwn(out, key, child);
    } else if (key === "description" && typeof child === "string") {
      const next = cutText(child, max, "[shortened]");
      shortened ||= next !== child;
      setOwn(out, key, next);
    } else {
      const next = SCHEMA_MAP_KEYS.has(key)
        ? compactSchemaMap(child, max)
        : compactSchema(child, max);
      shortened ||= next.shortened;
      setOwn(out, key, next.schema);
    }
  }
  return { schema: out, shortened };
};

/**
 * One tool's description and schema, compacted; `note(name)` is appended to
 * a shortened tool's description and says where the full text is.
 */
export const compactToolSchema = (
  tool: TLookupEntry,
  note: (name: string) => string,
  limits: TCompactionLimits = DEFAULT_LIMITS,
): { readonly tool: TLookupEntry; readonly shortened: boolean } => {
  const params = compactSchema(tool.inputSchema, limits.param);
  const ownCut = tool.description.length > limits.tool;
  if (!ownCut && !params.shortened) return { tool, shortened: false };
  return {
    tool: {
      name: tool.name,
      description: ownCut
        ? cutText(tool.description, limits.tool, note(tool.name))
        : `${tool.description} ${note(tool.name)}`,
      inputSchema: params.schema as Record<string, unknown>,
    },
    shortened: true,
  };
};

/** The note a shortened listed tool carries: its full schema is one find. */
export const lookupDetailsNote = (name: string): string =>
  `[Shortened. Full text: ${OPENLLM_API_FIND_TOOL} {"query":"${name}"}.]`;
