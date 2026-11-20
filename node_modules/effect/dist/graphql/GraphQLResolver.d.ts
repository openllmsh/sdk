import * as Cause from "../Cause.ts";
import * as Context from "../Context.ts";
import * as Effect from "../Effect.ts";
import * as Request from "../Request.ts";
import * as RequestResolver from "../RequestResolver.ts";
import type * as Types from "../Types.ts";
import type * as GraphQL from "./GraphQL.ts";
import type { OperationMethod } from "./GraphQLClient.ts";
type NonNull<A> = Exclude<A, null | undefined>;
type Step<A, K> = K extends keyof NonNull<A> ? NonNull<A>[K] : never;
type CheckPath<A, P> = NonNull<A> extends ReadonlyArray<any> ? readonly [] : P extends readonly [infer Head, ...infer Tail] ? readonly [Head extends keyof NonNull<A> ? Head : keyof NonNull<A>, ...CheckPath<Step<A, Head>, Tail>] : readonly [keyof NonNull<A>];
type Path<A, P> = P extends CheckPath<A, P> ? P : CheckPath<A, P>;
type AtPath<A, P> = P extends readonly [infer Head, ...infer Tail] ? AtPath<Step<A, Head>, Tail> : A;
type Item<A, P> = NonNull<AtPath<A, P>> extends ReadonlyArray<infer I> ? NonNull<I> : never;
type Typenames<I> = Types.IsUnion<I> extends true ? I extends {
    readonly __typename: infer T extends string;
} ? T : never : never;
type Narrow<I, T> = [T] extends [never] ? I : Extract<I, {
    readonly __typename: T;
}>;
type BatchKey<Op extends GraphQL.Any> = [GraphQL.Services<Op>] extends [never] ? {
    readonly batchKey?: never;
} : {
    readonly batchKey: (context: Context.Context<GraphQL.Services<Op>>) => unknown;
};
interface KeyRequest<K, A, E, R> extends Request.Request<A, E, R> {
    readonly key: K;
    /** The protocol URL {@link request} resolved for this lookup, if it could. */
    readonly url: string | undefined;
}
/**
 * Looks up a key with an {@link ordered}, {@link findById} or {@link aliased}
 * resolver, using `request(resolver)(key)` or `request(key, resolver)`.
 *
 * **Details**
 *
 * Concurrent lookups are batched. Keys equal under `Equal` and `Hash`
 * are sent once per batch and share the result.
 *
 * **Example** (Looking up repositories by id)
 *
 * ```ts import.meta.vitest
 * import { Effect, Layer, Schema, Stream } from "effect"
 * import { GraphQL, GraphQLClient, GraphQLGroup, GraphQLProtocol, GraphQLResolver } from "effect/graphql"
 *
 * const RepoNodes = GraphQL.query("RepoNodes", {
 *   document: "query RepoNodes($ids:[ID!]!){nodes(ids:$ids){... on Repository{name}}}",
 *   variables: { ids: Schema.Array(Schema.String) },
 *   result: Schema.Struct({ nodes: Schema.Array(Schema.NullOr(Schema.Struct({ name: Schema.String }))) })
 * })
 *
 * let calls = 0
 * const Scripted = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
 *   execute: (request) => {
 *     calls++
 *     const { ids } = request.variables as { ids: Array<string> }
 *     return Effect.succeed({ body: { data: { nodes: ids.map((id) => ({ name: `repo-${id}` })) } } })
 *   },
 *   subscribe: () => Stream.empty
 * })
 *
 * const program = Effect.gen(function*() {
 *   const client = yield* GraphQLClient.make(GraphQLGroup.make(RepoNodes))
 *   const getRepo = GraphQLResolver.request(GraphQLResolver.ordered(client.RepoNodes, {
 *     variables: (ids: ReadonlyArray<string>) => ({ ids }),
 *     path: ["nodes"]
 *   }))
 *   const repos = yield* Effect.forEach(["1", "2", "1"], getRepo, { concurrency: "unbounded" })
 *   return [repos.map((repo) => repo.name), calls]
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provide(Scripted))) // => [["repo-1", "repo-2", "repo-1"], 1]
 * ```
 *
 * @stability experimental
 * @category running
 * @since 4.0.0
 */
export declare const request: {
    /**
     * Looks up a key with an {@link ordered}, {@link findById} or {@link aliased}
     * resolver, using `request(resolver)(key)` or `request(key, resolver)`.
     *
     * **Details**
     *
     * Concurrent lookups are batched. Keys equal under `Equal` and `Hash`
     * are sent once per batch and share the result.
     *
     * **Example** (Looking up repositories by id)
     *
     * ```ts import.meta.vitest
     * import { Effect, Layer, Schema, Stream } from "effect"
     * import { GraphQL, GraphQLClient, GraphQLGroup, GraphQLProtocol, GraphQLResolver } from "effect/graphql"
     *
     * const RepoNodes = GraphQL.query("RepoNodes", {
     *   document: "query RepoNodes($ids:[ID!]!){nodes(ids:$ids){... on Repository{name}}}",
     *   variables: { ids: Schema.Array(Schema.String) },
     *   result: Schema.Struct({ nodes: Schema.Array(Schema.NullOr(Schema.Struct({ name: Schema.String }))) })
     * })
     *
     * let calls = 0
     * const Scripted = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
     *   execute: (request) => {
     *     calls++
     *     const { ids } = request.variables as { ids: Array<string> }
     *     return Effect.succeed({ body: { data: { nodes: ids.map((id) => ({ name: `repo-${id}` })) } } })
     *   },
     *   subscribe: () => Stream.empty
     * })
     *
     * const program = Effect.gen(function*() {
     *   const client = yield* GraphQLClient.make(GraphQLGroup.make(RepoNodes))
     *   const getRepo = GraphQLResolver.request(GraphQLResolver.ordered(client.RepoNodes, {
     *     variables: (ids: ReadonlyArray<string>) => ({ ids }),
     *     path: ["nodes"]
     *   }))
     *   const repos = yield* Effect.forEach(["1", "2", "1"], getRepo, { concurrency: "unbounded" })
     *   return [repos.map((repo) => repo.name), calls]
     * })
     *
     * await Effect.runPromise(program.pipe(Effect.provide(Scripted))) // => [["repo-1", "repo-2", "repo-1"], 1]
     * ```
     *
     * @stability experimental
     * @category running
     * @since 4.0.0
     */
    <K, A, E, R>(resolver: RequestResolver.RequestResolver<KeyRequest<K, A, E, R>>): (key: K) => Effect.Effect<A, E, R>;
    /**
     * Looks up a key with an {@link ordered}, {@link findById} or {@link aliased}
     * resolver, using `request(resolver)(key)` or `request(key, resolver)`.
     *
     * **Details**
     *
     * Concurrent lookups are batched. Keys equal under `Equal` and `Hash`
     * are sent once per batch and share the result.
     *
     * **Example** (Looking up repositories by id)
     *
     * ```ts import.meta.vitest
     * import { Effect, Layer, Schema, Stream } from "effect"
     * import { GraphQL, GraphQLClient, GraphQLGroup, GraphQLProtocol, GraphQLResolver } from "effect/graphql"
     *
     * const RepoNodes = GraphQL.query("RepoNodes", {
     *   document: "query RepoNodes($ids:[ID!]!){nodes(ids:$ids){... on Repository{name}}}",
     *   variables: { ids: Schema.Array(Schema.String) },
     *   result: Schema.Struct({ nodes: Schema.Array(Schema.NullOr(Schema.Struct({ name: Schema.String }))) })
     * })
     *
     * let calls = 0
     * const Scripted = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
     *   execute: (request) => {
     *     calls++
     *     const { ids } = request.variables as { ids: Array<string> }
     *     return Effect.succeed({ body: { data: { nodes: ids.map((id) => ({ name: `repo-${id}` })) } } })
     *   },
     *   subscribe: () => Stream.empty
     * })
     *
     * const program = Effect.gen(function*() {
     *   const client = yield* GraphQLClient.make(GraphQLGroup.make(RepoNodes))
     *   const getRepo = GraphQLResolver.request(GraphQLResolver.ordered(client.RepoNodes, {
     *     variables: (ids: ReadonlyArray<string>) => ({ ids }),
     *     path: ["nodes"]
     *   }))
     *   const repos = yield* Effect.forEach(["1", "2", "1"], getRepo, { concurrency: "unbounded" })
     *   return [repos.map((repo) => repo.name), calls]
     * })
     *
     * await Effect.runPromise(program.pipe(Effect.provide(Scripted))) // => [["repo-1", "repo-2", "repo-1"], 1]
     * ```
     *
     * @stability experimental
     * @category running
     * @since 4.0.0
     */
    <K, A, E, R>(key: K, resolver: RequestResolver.RequestResolver<KeyRequest<K, A, E, R>>): Effect.Effect<A, E, R>;
};
/**
 * Batches lookups for fields such as `nodes(ids:)` that return one entry per
 * key in input order.
 *
 * **Details**
 *
 * `variables` maps batch keys to operation variables; annotate its parameter
 * to set the key type. `path` selects a list through object fields, with
 * autocomplete at each level. For `__typename` unions, `typename` narrows
 * the success type and treats other types as missing.
 *
 * Null entries, typename mismatches and null parents fail with
 * `Cause.NoSuchElementError`. GraphQL errors whose paths start with
 * `[...path, i]` fail only entry `i`; its `ResponseError` contains those errors
 * and the response status. Other GraphQL errors fail the batch with the same
 * `ResponseError` as a non-partial call. Transport, encode and decode errors
 * also fail the batch. A list length mismatch fails with `DecodeError`.
 *
 * `pageInfo.hasNextPage: true` on the list's parent fails the batch with
 * `DecodeError` to avoid reporting unreturned entries as missing. Set the
 * operation's page size at least as large as `RequestResolver.batchN`.
 *
 * A batch uses one lookup's services. Methods requiring services also require
 * `batchKey`; only lookups with keys equal under `Equal` share a batch. Return
 * the value that distinguishes those services, for example
 * `(context) => Context.get(context, CurrentUser).tenantId`. Methods without
 * services use one batch and do not accept `batchKey`.
 *
 * **Gotchas**
 *
 * Don't return the whole context from `batchKey`. It also holds the caller's
 * span, so most lookups would get a batch of their own.
 *
 * A middleware that reads a `Context.Reference` with a default value doesn't
 * add it to the method's services. `batchKey` isn't required for it, and
 * lookups with different values can share a batch.
 *
 * **Example** (Looking up repositories in a `Node` union)
 *
 * ```ts import.meta.vitest
 * import { Cause, Effect, Layer, RequestResolver, Schema, Stream } from "effect"
 * import { GraphQL, GraphQLClient, GraphQLGroup, GraphQLProtocol, GraphQLResolver } from "effect/graphql"
 *
 * const Repository = Schema.Struct({ __typename: Schema.Literal("Repository"), nameWithOwner: Schema.String })
 * const User = Schema.Struct({ __typename: Schema.Literal("User"), login: Schema.String })
 *
 * const RepoNodes = GraphQL.query("RepoNodes", {
 *   document: "query RepoNodes($ids:[ID!]!){nodes(ids:$ids){__typename ...on Repository{nameWithOwner} ...on User{login}}}",
 *   variables: { ids: Schema.Array(Schema.String) },
 *   result: Schema.Struct({ nodes: Schema.Array(Schema.NullOr(Schema.Union([Repository, User]))) })
 * })
 *
 * const store: Record<string, unknown> = {
 *   R_1: { __typename: "Repository", nameWithOwner: "Effect-TS/effect" },
 *   U_1: { __typename: "User", login: "tim" }
 * }
 * const Scripted = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
 *   execute: (request) => {
 *     const { ids } = request.variables as { ids: Array<string> }
 *     return Effect.succeed({ body: { data: { nodes: ids.map((id) => store[id] ?? null) } } })
 *   },
 *   subscribe: () => Stream.empty
 * })
 *
 * const program = Effect.gen(function*() {
 *   const client = yield* GraphQLClient.make(GraphQLGroup.make(RepoNodes))
 *   const RepoById = GraphQLResolver.ordered(client.RepoNodes, {
 *     variables: (ids: ReadonlyArray<string>) => ({ ids }),
 *     path: ["nodes"],
 *     typename: "Repository"
 *   }).pipe(RequestResolver.batchN(100))
 *   const getRepo = GraphQLResolver.request(RepoById)
 *   return yield* Effect.forEach(
 *     ["R_1", "U_1", "R_2"],
 *     (id) => getRepo(id).pipe(
 *       Effect.map((repo) => repo.nameWithOwner),
 *       Effect.catchIf(Cause.isNoSuchElementError, () => Effect.succeed("missing"))
 *     ),
 *     { concurrency: "unbounded" }
 *   )
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provide(Scripted))) // => ["Effect-TS/effect", "missing", "missing"]
 * ```
 *
 * @stability experimental
 * @category resolvers
 * @since 4.0.0
 */
export declare const ordered: <Op extends GraphQL.Any, K, const P extends ReadonlyArray<string>, T extends Typenames<Item<GraphQL.Result<Op>, P>> = never>(method: OperationMethod<Op>, options: {
    readonly variables: (keys: ReadonlyArray<K>) => GraphQL.Variables<Op>;
    readonly path: Path<GraphQL.Result<Op>, P>;
    readonly typename?: T | undefined;
} & BatchKey<Op>) => RequestResolver.RequestResolver<KeyRequest<K, Narrow<Item<GraphQL.Result<Op>, P>, T>, GraphQL.Error<Op> | Cause.NoSuchElementError, GraphQL.Services<Op>>>;
/**
 * Batches lookups by key for searches and collections that return results
 * in any order.
 *
 * **Details**
 *
 * Write `key` before `variables` to infer the key type from its return type.
 * `variables` maps batch keys to operation variables. Keys are compared with
 * `Equal` and `Hash`. `path` and `typename` work as in {@link ordered};
 * `key` receives the narrowed item type.
 *
 * Missing keys, null parents, pagination and `batchKey` behave as in
 * {@link ordered}.
 * Any GraphQL error fails the batch with the same `ResponseError` as a
 * non-partial call, since error paths cannot be matched to keys.
 *
 * **Example** (Finding repositories through search)
 *
 * ```ts import.meta.vitest
 * import { Effect, Layer, Schema, Stream } from "effect"
 * import { GraphQL, GraphQLClient, GraphQLGroup, GraphQLProtocol, GraphQLResolver } from "effect/graphql"
 *
 * const Repository = Schema.Struct({ __typename: Schema.Literal("Repository"), nameWithOwner: Schema.String })
 * const User = Schema.Struct({ __typename: Schema.Literal("User"), login: Schema.String })
 *
 * const SearchRepos = GraphQL.query("SearchRepos", {
 *   document: "query SearchRepos($query:String!){search(query:$query,type:REPOSITORY,first:100){pageInfo{hasNextPage} nodes{__typename ...on Repository{nameWithOwner} ...on User{login}}}}",
 *   variables: { query: Schema.String },
 *   result: Schema.Struct({
 *     search: Schema.Struct({
 *       pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
 *       nodes: Schema.NullOr(Schema.Array(Schema.NullOr(Schema.Union([Repository, User]))))
 *     })
 *   })
 * })
 *
 * const Scripted = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
 *   execute: (request) => {
 *     const { query } = request.variables as { query: string }
 *     const nodes = query.split(" ").map((term) => ({ __typename: "Repository", nameWithOwner: term.slice(5) }))
 *     return Effect.succeed({ body: { data: { search: { pageInfo: { hasNextPage: false }, nodes: nodes.reverse() } } } })
 *   },
 *   subscribe: () => Stream.empty
 * })
 *
 * const program = Effect.gen(function*() {
 *   const client = yield* GraphQLClient.make(GraphQLGroup.make(SearchRepos))
 *   const RepoByName = GraphQLResolver.findById(client.SearchRepos, {
 *     key: (repo) => repo.nameWithOwner,
 *     variables: (names) => ({ query: names.map((name) => `repo:${name}`).join(" ") }),
 *     path: ["search", "nodes"],
 *     typename: "Repository"
 *   })
 *   const repos = yield* Effect.forEach(
 *     ["Effect-TS/effect", "Effect-TS/website"],
 *     GraphQLResolver.request(RepoByName),
 *     { concurrency: "unbounded" }
 *   )
 *   return repos.map((repo) => repo.nameWithOwner)
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provide(Scripted))) // => ["Effect-TS/effect", "Effect-TS/website"]
 * ```
 *
 * @stability experimental
 * @category resolvers
 * @since 4.0.0
 */
export declare const findById: <Op extends GraphQL.Any, K, const P extends ReadonlyArray<string>, T extends Typenames<Item<GraphQL.Result<Op>, P>> = never>(method: OperationMethod<Op>, options: {
    readonly variables: (keys: ReadonlyArray<K>) => GraphQL.Variables<Op>;
    readonly path: Path<GraphQL.Result<Op>, P>;
    readonly key: (item: Narrow<Item<GraphQL.Result<Op>, P>, T>) => K;
    readonly typename?: T | undefined;
} & BatchKey<Op>) => RequestResolver.RequestResolver<KeyRequest<K, Narrow<Item<GraphQL.Result<Op>, P>, T>, GraphQL.Error<Op> | Cause.NoSuchElementError, GraphQL.Services<Op>>>;
/**
 * Batches calls to a generated query or mutation by repeating the operation
 * under aliases in one request.
 *
 * **When to use**
 *
 * Use when the API has no list-key field, such as GitHub's pull requests by
 * repository and number. Otherwise, {@link ordered} or {@link findById} send
 * a smaller query.
 *
 * **Details**
 *
 * Use {@link request} to get `(variables) => Effect`. Variables that encode
 * to the same JSON share a slice; each slice uses the operation's result Schema.
 * Throws when the resolver is built if the operation has no document
 * template, if an operation directive references a variable, or if a root
 * selection is a fragment spread or inline fragment, since none of these can
 * be repeated under aliases.
 *
 * Batches use `POST` even with `queryMethod: "GET"`. The default batch size
 * is 10; change it with `RequestResolver.batchN`. Middleware run once per
 * batch, and `batchKey` works as in {@link ordered}. Mock and custom methods
 * are called once per slice instead.
 *
 * Errors with a matching `path[0]` fail only that slice, with the alias prefix
 * removed from the error path. Errors without a matching path, transport errors
 * and middleware failures fail the batch.
 *
 * **Gotchas**
 *
 * An error under a non-null root field can null the entire response, failing
 * every slice. GitHub's `repository` and `pullRequest` are nullable.
 *
 * Middleware that hash queries must use `request.query`, not
 * `operation.document`. Trusted-document allowlists don't support batching;
 * query hashing does, since the same operation and slice count produce the
 * same document.
 *
 * Mutations are allowed, but the caller cannot control root-field order.
 *
 * **Example** (Looking up pull requests by number)
 *
 * ```ts import.meta.vitest
 * import { Effect, Layer, RequestResolver, Schema, Stream } from "effect"
 * import { GraphQL, GraphQLClient, GraphQLGroup, GraphQLProtocol, GraphQLResolver } from "effect/graphql"
 *
 * // Generated from:
 * //   query PullRequest($owner: String!, $name: String!, $number: Int!) {
 * //     repository(owner: $owner, name: $name) { pullRequest(number: $number) { title } }
 * //   }
 * const PullRequest = GraphQL.query("PullRequest", {
 *   document: {
 *     variables: [
 *       { name: "owner", body: "String!" },
 *       { name: "name", body: "String!" },
 *       { name: "number", body: "Int!" }
 *     ],
 *     selections: [{
 *       name: "repository",
 *       body: ["(owner:$", "owner", ",name:$", "name", "){pullRequest(number:$", "number", "){title}}"]
 *     }],
 *     fragments: []
 *   },
 *   variables: { owner: Schema.String, name: Schema.String, number: Schema.Int },
 *   result: Schema.Struct({
 *     repository: Schema.NullOr(Schema.Struct({
 *       pullRequest: Schema.NullOr(Schema.Struct({ title: Schema.String }))
 *     }))
 *   })
 * })
 *
 * // A stand-in server that answers every aliased slice
 * const queries: Array<string> = []
 * const Scripted = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
 *   execute: (request) => {
 *     queries.push(request.query)
 *     const data: Record<string, unknown> = {}
 *     for (const [key, number] of Object.entries(request.variables as Record<string, unknown>)) {
 *       const prefix = /^(_\d+_)number$/.exec(key)?.[1]
 *       if (prefix !== undefined) data[`${prefix}repository`] = { pullRequest: { title: `PR ${number}` } }
 *     }
 *     return Effect.succeed({ body: { data } })
 *   },
 *   subscribe: () => Stream.empty
 * })
 *
 * const program = Effect.gen(function*() {
 *   const github = yield* GraphQLClient.make(GraphQLGroup.make(PullRequest))
 *   const PullRequests = GraphQLResolver.aliased(github.PullRequest).pipe(RequestResolver.batchN(20))
 *   const getPullRequest = GraphQLResolver.request(PullRequests)
 *   const results = yield* Effect.forEach(
 *     [1, 2, 3],
 *     (number) => getPullRequest({ owner: "Effect-TS", name: "effect", number }),
 *     { concurrency: "unbounded" }
 *   )
 *   return [results.map((result) => result.repository?.pullRequest?.title), queries.length]
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provide(Scripted))) // => [["PR 1", "PR 2", "PR 3"], 1]
 * ```
 *
 * @stability experimental
 * @category resolvers
 * @since 4.0.0
 */
export declare const aliased: <Op extends GraphQL.Any>(method: OperationMethod<Op>, ...[options]: {} extends BatchKey<Op> ? [options?: BatchKey<Op>] : [options: BatchKey<Op>]) => RequestResolver.RequestResolver<AliasedRequest<Op>>;
type AliasedRequest<Op extends GraphQL.Any> = KeyRequest<GraphQL.Variables<Op>, GraphQL.Result<Op>, GraphQL.Error<Op>, GraphQL.Services<Op>>;
export {};
//# sourceMappingURL=GraphQLResolver.d.ts.map