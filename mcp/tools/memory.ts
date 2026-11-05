/**
 * memory tool group — defs + dispatcher, composed into the ONE
 * MCP server by `../server.ts`. Project identity is injected via
 * `MemoryConfig` — this module never reads `process.cwd()` or git.
 */

import type { TToolResult } from "../types";
import { MemoryClient } from "./memory-client";
import type { MemoryConfig, TProjectRef } from "./memory-config";

const MAX_CONTENT_LENGTH = 200_000;
const MAX_QUERY_LENGTH = 1_000;
const MAX_PROJECT_LENGTH = 64;

const memoryDescription =
  "Cross-session memory for this user. Personal is the default; team sharing is automatic for repos that match a team the user belongs to — do NOT try to target arbitrary teams. " +
  "PROACTIVELY call with action='save' when the user reveals: a preference or working-style rule, a fact about themselves or their team, feedback that should shape future behavior (corrections AND confirmations of non-obvious choices), an external reference (Linear project, Slack channel, dashboard, runbook), or a project goal/deadline/constraint not derivable from code. Saving is cheap; missing a save means the next session starts blind. " +
  "Use action='forget' when a memory is outdated or the user asks to remove it (exact `(project, content)` hash first, then semantic similarity >= 0.85 within the same project). " +
  "Optional `project` slug scopes the memory to a named personal bucket (default: 'default'). " +
  "For personal multi-project fan-out, pass `destinations: [{project}, ...]` — each entry writes the same content to one personal project slug. Call `whoAmI` for identity (email/role/teams); teams listed there are informational only.";

const recallDescription =
  "Cross-session recall for this user. " +
  "Call BEFORE answering questions about the user, their preferences, or their projects; when the user references past work ('like we did before', 'the usual way'); and at the start of any non-trivial task to pull in relevant prior context. " +
  "Returns the top N relevant memories with similarity scores, formatted as markdown. Team-matched project memories are included automatically. " +
  "Note: a `UserPromptSubmit` hook auto-injects relevant memories on every prompt — if you already see a '[memory] Relevant saved memories (auto-recalled):' block in context, only re-query with a different angle. " +
  "Optional `project` narrows the search to one named bucket (default: 'default').";

const whoAmIDescription =
  "Identify which gateway account this MCP server is bound to. Returns email, role, and team memberships (informational — do not try to target teams by id when saving; team sharing is automatic for matched project repos). Useful for debugging MCP configuration.";

export const memoryToolDefs = [
  {
    name: "memory",
    description: memoryDescription,
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "The memory content to save or forget (e.g. 'User prefers dark mode').",
          maxLength: MAX_CONTENT_LENGTH,
        },
        action: {
          type: "string",
          enum: ["save", "forget"],
          default: "save",
        },
        project: {
          type: "string",
          description:
            "Optional project slug (a-z, 0-9, ., _, -). Defaults to 'default'. Ignored when `destinations` is provided.",
          maxLength: MAX_PROJECT_LENGTH,
        },
        destinations: {
          type: "array",
          description:
            "Optional personal fan-out targets. Each entry picks a project slug (defaults to 'default' if omitted). The same content is written once per destination — use this for facts that span multiple personal projects. Team sharing is automatic via project matching; do not try to target teams here.",
          items: {
            type: "object",
            properties: {
              project: {
                type: "string",
                maxLength: MAX_PROJECT_LENGTH,
                description:
                  "Project slug for this destination. Optional; defaults to 'default'.",
              },
            },
          },
        },
      },
      required: ["content"],
    },
  },
  {
    name: "recall",
    description: recallDescription,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query to search saved memories.",
          maxLength: MAX_QUERY_LENGTH,
        },
        limit: {
          type: "number",
          default: 10,
          maximum: 50,
          minimum: 1,
        },
        project: {
          type: "string",
          description:
            "Optional project slug to scope the search. Defaults to 'default'.",
          maxLength: MAX_PROJECT_LENGTH,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "whoAmI",
    description: whoAmIDescription,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

const clientFor = (() => {
  let cached: { key: string; client: MemoryClient } | null = null;
  return (config: MemoryConfig): MemoryClient => {
    const key = `${config.gatewayUrl}\0${config.gatewayApiKey}`;
    if (cached === null || cached.key !== key) {
      cached = { key, client: new MemoryClient(config) };
    }
    return cached.client;
  };
})();

/** Tiny basename without `node:path`. */
const basenameOf = (path: string): string => {
  const trimmed = path.replace(/[/\\]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
};

const slugify = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 64);

const defaultResolveProject = (
  config: MemoryConfig,
  override?: string,
): string => {
  if (config.resolveProject) return config.resolveProject(override);
  const explicit = override ? slugify(override) : "";
  if (explicit) return explicit;
  if (typeof config.cwd === "string" && config.cwd.length > 0) {
    return slugify(basenameOf(config.cwd)) || "default";
  }
  return "default";
};

const defaultBuildProjectRef = (
  config: MemoryConfig,
  projectSlug: string,
): TProjectRef => {
  if (config.buildProjectRef) return config.buildProjectRef(projectSlug);
  return { slug: projectSlug };
};

const handleMemory = async (
  client: MemoryClient,
  config: MemoryConfig,
  args: {
    content: string;
    action?: "save" | "forget";
    project?: string;
    destinations?: Array<{ project?: string }>;
  },
): Promise<TToolResult> => {
  const action = args.action ?? "save";
  if (!args?.content) {
    return {
      content: [{ type: "text" as const, text: "Error: content is required" }],
      isError: true,
    };
  }
  if (args.content.length > MAX_CONTENT_LENGTH) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: content exceeds max length of ${MAX_CONTENT_LENGTH} chars`,
        },
      ],
      isError: true,
    };
  }

  if (action === "save") {
    // Collapse `destinations: [{project}, ...]` into projects[]. Team ids are
    // never accepted from the agent — matching is automatic via project_ref.
    const projectSet = new Set<string>();
    const hasDestinations = Array.isArray(args.destinations);
    // `project` is documented as ignored when `destinations` is provided.
    if (
      !hasDestinations &&
      typeof args.project === "string" &&
      args.project.trim()
    ) {
      projectSet.add(args.project.trim());
    }
    if (Array.isArray(args.destinations)) {
      for (const d of args.destinations) {
        if (!d || typeof d !== "object") continue;
        if (typeof d.project === "string" && d.project.trim()) {
          projectSet.add(d.project.trim());
        }
      }
    }
    const primarySlug =
      projectSet.size > 0
        ? ([...projectSet][0] ?? defaultResolveProject(config))
        : typeof args.project === "string" && args.project.trim()
          ? args.project.trim()
          : defaultResolveProject(config);
    const project_ref = defaultBuildProjectRef(config, primarySlug);
    try {
      // Personal save with project_ref so the server can record observations
      // and gate any future explicit team targets. Automatic team fan-out for
      // project facts is the extract hook's job (scope=project → matched teams).
      const res = await client.save(args.content, {
        projects: projectSet.size > 0 ? Array.from(projectSet) : undefined,
        project_ref,
        metadata: { source: "tool" },
      });
      const projTag = res.projects.join(",");
      const teamTag = res.teams.length ? ` · teams=${res.teams.join(",")}` : "";
      const reusedTag = res.reused ? " (merged into existing chunk)" : "";
      return {
        content: [
          {
            type: "text" as const,
            text: `Saved memory ${res.id} (projects=${projTag}${teamTag})${reusedTag}`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          { type: "text" as const, text: `Error saving memory: ${msg}` },
        ],
        isError: true,
      };
    }
  }
  if (action === "forget") {
    const res = await client.forget(args.content, { project: args.project });
    return {
      content: [{ type: "text" as const, text: res.message }],
      isError: !res.success,
    };
  }
  return {
    content: [{ type: "text" as const, text: `Unknown action: ${action}` }],
    isError: true,
  };
};

const handleRecall = async (
  client: MemoryClient,
  config: MemoryConfig,
  args: { query: string; limit?: number; project?: string },
): Promise<TToolResult> => {
  if (!args?.query) {
    return {
      content: [{ type: "text" as const, text: "Error: query is required" }],
      isError: true,
    };
  }
  if (args.query.length > MAX_QUERY_LENGTH) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: query exceeds max length of ${MAX_QUERY_LENGTH} chars`,
        },
      ],
      isError: true,
    };
  }
  const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 10)));
  const projectSlug =
    typeof args.project === "string" && args.project.trim()
      ? args.project.trim()
      : defaultResolveProject(config);
  const res = await client.search(args.query, limit, {
    project: args.project,
    project_ref: defaultBuildProjectRef(config, projectSlug),
  });
  if (res.results.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No memories matched. (${res.timing}ms)`,
        },
      ],
    };
  }
  const parts: string[] = [
    `## Relevant memories (${res.results.length}, ${res.timing}ms)`,
  ];
  res.results.forEach((m, i) => {
    const pct = Math.round(m.similarity * 100);
    const teamName =
      typeof m.team_name === "string" && m.team_name.trim()
        ? m.team_name.trim()
        : "";
    const projectTag = m.project
      ? teamName
        ? ` · team ${teamName} · project=${m.project}`
        : ` · project=${m.project}`
      : teamName
        ? ` · team ${teamName}`
        : "";
    parts.push(`\n### ${i + 1}. ${pct}% match${projectTag}`);
    parts.push(m.memory);
  });
  return { content: [{ type: "text" as const, text: parts.join("\n") }] };
};

const handleWhoAmI = async (client: MemoryClient): Promise<TToolResult> => {
  const who = await client.whoami();
  const teamList = who.teams.length
    ? who.teams.map((t) => `${t.name} (${t.id})`).join(", ")
    : "(none)";
  const text = [
    `email: ${who.email}`,
    `role:  ${who.role}`,
    `teams: ${teamList}`,
  ].join("\n");
  return { content: [{ type: "text" as const, text }] };
};

export const handleMemoryTool = async (
  name: string,
  args: Record<string, unknown>,
  config: MemoryConfig,
): Promise<TToolResult> => {
  const client = clientFor(config);
  try {
    switch (name) {
      case "memory":
        return await handleMemory(
          client,
          config,
          args as Parameters<typeof handleMemory>[2],
        );
      case "recall":
        return await handleRecall(
          client,
          config,
          args as Parameters<typeof handleRecall>[2],
        );
      case "whoAmI":
        return await handleWhoAmI(client);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
};
