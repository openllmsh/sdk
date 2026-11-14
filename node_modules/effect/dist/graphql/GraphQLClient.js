/**
 * A typed client with one method per operation in a `GraphQLGroup`. Queries
 * and mutations return an `Effect`; subscriptions return a `Stream`. The
 * client encodes variables, runs middleware, calls the `GraphQLProtocol` in
 * context and decodes results.
 *
 * Retryable subscription failures restart the middleware chain on the
 * `subscriptionRetry` schedule. {@link pages} and {@link items} provide
 * cursor pagination. {@link makeTest} builds a mock client for tests, and
 * {@link layerTest} provides it as a service layer. See `GraphQLProtocol`
 * for transport options.
 *
 * @stability experimental
 * @since 4.0.0
 */
import * as Cause from "../Cause.js";
import * as Context from "../Context.js";
import * as Duration from "../Duration.js";
import * as Effect from "../Effect.js";
import { identity } from "../Function.js";
import * as Headers from "../http/Headers.js";
import * as UrlParams from "../http/UrlParams.js";
import * as internalGraphQL from "../internal/graphql.js";
import { getStackTraceLimit, setStackTraceLimit } from "../internal/stackTraceLimit.js";
import * as Layer from "../Layer.js";
import * as Option from "../Option.js";
import * as Schedule from "../Schedule.js";
import * as Schema from "../Schema.js";
import * as Stream from "../Stream.js";
import * as Struct from "../Struct.js";
import { DecodeError, GraphQLClientError, isGraphQLClientError, PaginationError } from "./GraphQLClientError.js";
import { ExecutionResult, GraphQLProtocol } from "./GraphQLProtocol.js";
/**
 * The default subscription retry schedule: exponential from 500 milliseconds
 * with factor 1.5, capped at 5 seconds, and never shorter than the server's
 * `retryAfter`.
 *
 * @stability experimental
 * @category constants
 * @since 4.0.0
 */
export const defaultSubscriptionRetry = /*#__PURE__*/Schedule.exponential("500 millis", 1.5).pipe(/*#__PURE__*/Schedule.setInputType(), /*#__PURE__*/Schedule.modifyDelay(({
  duration,
  input
}) => {
  const capped = Duration.min(duration, Duration.seconds(5));
  return Effect.succeed(input.retryAfter === undefined ? capped : Duration.max(capped, input.retryAfter));
}));
/**
 * Builds a client from a group, requiring `GraphQLProtocol` and every
 * middleware service attached to the group or its operations.
 *
 * **Details**
 *
 * Group middleware runs outside operation middleware. Within each level,
 * middleware run in the order attached.
 *
 * `subscriptionRetry` decides how a subscription is retried after it fails
 * with a retryable error: usually a `TransportError`, but also a
 * `ResponseError` whose response carried a valid `Retry-After`, including an
 * event with `errors` on a graphql-sse stream whose response had that header.
 * It defaults to {@link defaultSubscriptionRetry}. Fatal errors are never
 * retried, whatever the schedule. A retry starts a new subscription, so the
 * server may send events again that the stream already emitted.
 *
 * **Example** (A client as a service)
 *
 * ```ts import.meta.vitest
 * import { Context, Effect, Layer, Schema, Stream } from "effect"
 * import { GraphQL, GraphQLClient, GraphQLGroup, GraphQLProtocol } from "effect/graphql"
 *
 * // What the generator emits for viewer.graphql
 * const Viewer = GraphQL.query("Viewer", {
 *   document: "query Viewer{viewer{login}}",
 *   result: Schema.Struct({ viewer: Schema.Struct({ login: Schema.String }) })
 * })
 * const ViewerGraphQLGroup = GraphQLGroup.make(Viewer)
 *
 * class GitHub extends Context.Service<GitHub>()("app/GitHub", {
 *   make: GraphQLClient.make(ViewerGraphQLGroup)
 * }) {}
 *
 * // A scripted transport; use GraphQLProtocol.layerHttp({ url }) for a real server
 * const Scripted = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
 *   execute: () => Effect.succeed({ body: { data: { viewer: { login: "tim" } } } }),
 *   subscribe: () => Stream.empty
 * })
 *
 * const program = GitHub.use((github) => github.Viewer()).pipe(
 *   Effect.provide(Layer.effect(GitHub, GitHub.make).pipe(Layer.provide(Scripted)))
 * )
 *
 * await Effect.runPromise(program) // => { viewer: { login: "tim" } }
 * ```
 *
 * **Example** (Partial results)
 *
 * ```ts import.meta.vitest
 * import { Effect, Layer, Schema, Stream } from "effect"
 * import { GraphQL, GraphQLClient, GraphQLGroup, GraphQLProtocol } from "effect/graphql"
 *
 * const Repos = GraphQL.query("Repos", {
 *   document: "query Repos{a:repository(owner:\"x\",name:\"a\"){name} b:repository(owner:\"x\",name:\"b\"){name}}",
 *   result: Schema.Struct({
 *     a: Schema.NullOr(Schema.Struct({ name: Schema.String })),
 *     b: Schema.NullOr(Schema.Struct({ name: Schema.String }))
 *   })
 * })
 *
 * const Scripted = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
 *   execute: () =>
 *     Effect.succeed({
 *       body: {
 *         data: { a: { name: "a" }, b: null },
 *         errors: [{ message: "Could not resolve to a Repository", path: ["b"] }]
 *       }
 *     }),
 *   subscribe: () => Stream.empty
 * })
 *
 * const program = Effect.gen(function*() {
 *   const client = yield* GraphQLClient.make(GraphQLGroup.make(Repos))
 *   // The default call fails with a ResponseError because `errors` is non-empty
 *   const failed = yield* Effect.flip(client.Repos())
 *   // With partial: true the decoded data comes back together with the errors
 *   const { data, errors } = yield* client.Repos(undefined, { partial: true })
 *   return [failed.reason._tag, data.a?.name, errors[0].path?.[0]]
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provide(Scripted))) // => ["ResponseError", "a", "b"]
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export const make = (group, options) => Effect.gen(function* () {
  const protocol = yield* GraphQLProtocol;
  const context = yield* Effect.context();
  const retryPolicy = retryableOnly(options?.subscriptionRetry ?? defaultSubscriptionRetry);
  return fromGroup(group, operation => makeMethod(operation, middlewareChain(context, group, operation), protocol, retryPolicy));
});
// Type boundary: a mapping over the operations cannot prove the mapped type's
// name/kind relationship.
const fromGroup = (group, f) => Object.fromEntries(group.operations.map(operation => [operation.name, f(operation)]));
// Runtime tags erase middleware types; `make` requires all their identifiers.
const middlewareChain = (context, group, operation) => [...group.middlewares, ...operation.middlewares].map(tag => Context.getUnsafe(context, tag));
// Steps `schedule` only for retryable `GraphQLClientError`s. Middleware
// errors and fatal errors end the retries before reaching it, so a custom
// schedule can rely on its input being a `GraphQLClientError`.
const retryableOnly = schedule => Schedule.fromStep(Effect.map(Schedule.toStep(schedule), step => (now, input) => isGraphQLClientError(input) && input.isRetryable ? step(now, input) : Cause.done(undefined)));
// `status` and `headers` are transport metadata, never read from the body.
const decodeExecutionResult = /*#__PURE__*/Schema.decodeUnknownEffect(/*#__PURE__*/ExecutionResult.mapFields(/*#__PURE__*/Struct.omit(["status", "headers"])));
// Type boundary: a call without `context` has `R2 = never` unless the caller
// names `R2` explicitly, so an empty context stands in for `Context<R2>`.
const callContext = options => options?.context ?? Context.empty();
const makeMethod = (operation, chain, protocol, retryPolicy) => {
  const {
    decodePartial,
    decodeStrict,
    encodeVariables,
    fail,
    schemaFail
  } = internalGraphQL.makeCodec(operation);
  const notGraphQL = schemaFail(description => new DecodeError({
    description: `Not a GraphQL response: ${description}`
  }));
  const buildRequest = (variables, options) => encodeVariables(variables).pipe(Effect.map(encoded => ({
    kind: operation.kind,
    query: operation.document,
    operationName: operation.name,
    variables: encoded,
    headers: Headers.fromInput(options?.headers),
    urlParams: options?.urlParams === undefined ? UrlParams.empty : UrlParams.fromInput(options.urlParams)
  })));
  const decodeResponse = ({
    body,
    ...metadata
  }) => decodeExecutionResult(body).pipe(Effect.map(result => ({
    ...result,
    ...metadata
  })), Effect.catch(notGraphQL));
  // Type boundary: a middleware sees the errors of the middleware further in
  // as `Types.unhandled` (as in `RpcMiddleware`), and none of their
  // requirements. Those errors are part of `GraphQL.Error<Op>`, so the chain
  // restates its type here. Force POST and the resolved URL apply only at the
  // transport boundary.
  const execute = (index, request, forcePost, resolvedUrl) => index === chain.length ? protocol.execute(request).pipe(forcePost ? Effect.provideService(internalGraphQL.ForcePost, true) : identity, resolvedUrl === undefined ? identity : Effect.provideService(internalGraphQL.ResolvedUrl, resolvedUrl), Effect.mapError(fail), Effect.flatMap(decodeResponse)) : chain[index].execute({
    operation,
    request,
    next: request => execute(index + 1, request, forcePost, resolvedUrl)
  });
  // Hands a resolver batch's URL to the transport only, so calls made by
  // middleware resolve their own.
  const run = (request, forcePost) => internalGraphQL.ResolvedUrl.use(resolved => resolved === undefined ? execute(0, request, forcePost, undefined) : execute(0, request, forcePost, resolved).pipe(Effect.provideService(internalGraphQL.ResolvedUrl, undefined)));
  const subscribe = (index, request) => index === chain.length ? protocol.subscribe(request).pipe(Stream.mapError(fail), Stream.mapEffect(decodeResponse)) : chain[index].subscribe({
    operation,
    request,
    next: request => subscribe(index + 1, request)
  });
  if (operation.kind === "subscription") {
    const subscriptionMethod = (...[variables, options]) => Stream.unwrap(Effect.map(buildRequest(variables, options), request => subscribe(0, request))).pipe(Stream.mapEffect(decodeStrict), Stream.retry(retryPolicy), Stream.provideContext(callContext(options)));
    return Object.assign(subscriptionMethod, {
      operation
    });
  }
  function method(variables, options) {
    return buildRequest(variables, options).pipe(Effect.flatMap(request => run(request, false)), Effect.flatMap(result => options?.partial === true ? decodePartial(result) : decodeStrict(result)), Effect.provideContext(callContext(options)));
  }
  internalGraphQL.rawExecutors.set(method, {
    execute: request => run(request, true),
    url: protocol.url
  });
  return Object.assign(method, {
    operation
  });
};
/**
 * Pages forward through a cursor connection, emitting one connection per
 * page.
 *
 * **Details**
 *
 * Requires an optional string `$after` variable (see {@link PagingVariables}).
 * The first request omits `after`; subsequent requests use the previous
 * `endCursor`. Pages are fetched only when pulled, so `Stream.take` stops
 * further requests. Middleware runs on each page.
 *
 * `connection` extracts the connection from each result. `options` is
 * forwarded to every call but cannot include `partial`: errors fail the stream.
 * Its `headers` accept `Headers.Input`, just as for operation calls.
 *
 * The stream ends after a page whose `hasNextPage` is `false`. A `null`
 * connection on the first page gives an empty stream; on a later page it
 * fails with a `PaginationError`, as does `hasNextPage: true` with a `null`
 * or unchanged `endCursor`.
 *
 * Root fields that come with every page, such as GitHub's `rateLimit`, are for
 * middleware to read from the raw `ExecutionResult`.
 *
 * **Example** (Paging issues, two per page)
 *
 * ```ts import.meta.vitest
 * import { Effect, Layer, Schema, Stream } from "effect"
 * import { GraphQL, GraphQLClient, GraphQLGroup, GraphQLProtocol } from "effect/graphql"
 *
 * const RepoIssues = GraphQL.query("RepoIssues", {
 *   document: "query RepoIssues($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){issues(first:2,after:$after){pageInfo{hasNextPage endCursor}nodes{number}}}}",
 *   variables: { owner: Schema.String, name: Schema.String, after: Schema.optional(Schema.NullOr(Schema.String)) },
 *   result: Schema.Struct({
 *     repository: Schema.NullOr(Schema.Struct({
 *       issues: Schema.Struct({
 *         pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean, endCursor: Schema.NullOr(Schema.String) }),
 *         nodes: Schema.NullOr(Schema.Array(Schema.NullOr(Schema.Struct({ number: Schema.Int }))))
 *       })
 *     }))
 *   })
 * })
 *
 * // A scripted server with two pages
 * const Scripted = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
 *   execute: (request) => {
 *     const after = (request.variables as { after?: string }).after
 *     const page = after === undefined
 *       ? { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [{ number: 1 }, { number: 2 }] }
 *       : { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ number: 3 }] }
 *     return Effect.succeed({ body: { data: { repository: { issues: page } } } })
 *   },
 *   subscribe: () => Stream.empty
 * })
 *
 * const program = Effect.gen(function*() {
 *   const client = yield* GraphQLClient.make(GraphQLGroup.make(RepoIssues))
 *   const pages = GraphQLClient.pages(client.RepoIssues, {
 *     variables: { owner: "Effect-TS", name: "effect" },
 *     connection: (result) => result.repository?.issues
 *   })
 *   return yield* Stream.runCollect(Stream.map(pages, (page) => page.pageInfo.endCursor))
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provide(Scripted))) // => ["c1", null]
 * ```
 *
 * @stability experimental
 * @category paging
 * @since 4.0.0
 */
export const pages = (method, options) => {
  // Type boundary: `method`'s strict overload, with `variables` widened.
  // `PagingVariables` has already checked that `options.variables` plus an
  // optional string `after` are the operation's variables, but the overloads'
  // conditional parameter types over a generic `Op` cannot carry that here.
  const call = method;
  // The state is the cursor to send; the first page is fetched without one.
  return Stream.paginate(undefined, after => Effect.flatMap(call(after === undefined ? options.variables : {
    ...options.variables,
    after
  }, options.options), result => {
    const paginationError = description => Effect.fail(new GraphQLClientError({
      operation: method.operation.name,
      reason: new PaginationError({
        description,
        cursor: after ?? null
      })
    }));
    const connection = options.connection(result);
    if (connection === null || connection === undefined) {
      return after === undefined ? Effect.succeed([[], Option.none()]) : paginationError("The connection was null on a page after the first");
    }
    const {
      endCursor,
      hasNextPage
    } = connection.pageInfo;
    if (!hasNextPage) return Effect.succeed([[connection], Option.none()]);
    if (endCursor === null) return paginationError("hasNextPage is true but endCursor is null");
    if (endCursor === after) return paginationError(`endCursor "${endCursor}" did not advance`);
    return Effect.succeed([[connection], Option.some(endCursor)]);
  }));
};
/**
 * Like {@link pages}, but emits decoded entries from `nodes`, including
 * `null` entries. Use `Stream.filter(Predicate.isNotNull)` to drop them.
 * For connections selecting only `edges`, use {@link pages} with
 * `Stream.flatMap`.
 *
 * **Example** (Flattening issue numbers across pages)
 *
 * ```ts import.meta.vitest
 * import { Effect, Layer, Schema, Stream } from "effect"
 * import { GraphQL, GraphQLClient, GraphQLGroup, GraphQLProtocol } from "effect/graphql"
 *
 * const RepoIssues = GraphQL.query("RepoIssues", {
 *   document: "query RepoIssues($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){issues(first:2,after:$after){pageInfo{hasNextPage endCursor}nodes{number}}}}",
 *   variables: { owner: Schema.String, name: Schema.String, after: Schema.optional(Schema.NullOr(Schema.String)) },
 *   result: Schema.Struct({
 *     repository: Schema.NullOr(Schema.Struct({
 *       issues: Schema.Struct({
 *         pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean, endCursor: Schema.NullOr(Schema.String) }),
 *         nodes: Schema.NullOr(Schema.Array(Schema.NullOr(Schema.Struct({ number: Schema.Int }))))
 *       })
 *     }))
 *   })
 * })
 *
 * const Scripted = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
 *   execute: (request) => {
 *     const after = (request.variables as { after?: string }).after
 *     const page = after === undefined
 *       ? { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [{ number: 1 }, null] }
 *       : { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ number: 3 }] }
 *     return Effect.succeed({ body: { data: { repository: { issues: page } } } })
 *   },
 *   subscribe: () => Stream.empty
 * })
 *
 * const program = Effect.gen(function*() {
 *   const client = yield* GraphQLClient.make(GraphQLGroup.make(RepoIssues))
 *   const items = GraphQLClient.items(client.RepoIssues, {
 *     variables: { owner: "Effect-TS", name: "effect" },
 *     connection: (result) => result.repository?.issues
 *   })
 *   return yield* Stream.runCollect(Stream.map(items, (issue) => issue?.number ?? null))
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provide(Scripted))) // => [1, null, 3]
 * ```
 *
 * @stability experimental
 * @category paging
 * @since 4.0.0
 */
export const items = (method, options) => Stream.flatMap(pages(method, options), connection => Stream.fromArray(connection.nodes ?? []));
/**
 * Builds a client for tests that answers each operation from a handler,
 * without a protocol.
 *
 * **Details**
 *
 * Handlers receive the caller's `variables` and options unchanged and return
 * values in their decoded form. Nothing is encoded, decoded or validated, and
 * no middleware runs. Called with `{ partial: true }`, a method returns
 * `{ data, errors: [] }`. Subscriptions are not retried. Every method carries
 * `.operation`, so {@link pages} and {@link items} work on it.
 *
 * Calling an operation without a handler dies with an `UnimplementedError`
 * defect, so `catchTag` in the code under test cannot swallow a missing stub.
 *
 * Methods keep the real client's types, including middleware service
 * requirements. Tests must provide those services even though mocks do not
 * use them.
 *
 * To test partial data together with `errors`, or the encode and decode path,
 * provide a scripted `GraphQLProtocol` layer to {@link make} instead.
 *
 * **Example** (Replacing a client service in tests)
 *
 * ```ts import.meta.vitest
 * import { Context, Effect, Layer, Schema } from "effect"
 * import { GraphQL, GraphQLClient, GraphQLGroup } from "effect/graphql"
 *
 * const RepoIssues = GraphQL.query("RepoIssues", {
 *   document: "query RepoIssues($owner:String!,$name:String!){repository(owner:$owner,name:$name){issues{totalCount}}}",
 *   variables: { owner: Schema.String, name: Schema.String },
 *   result: Schema.Struct({
 *     repository: Schema.NullOr(Schema.Struct({ issues: Schema.Struct({ totalCount: Schema.Int }) }))
 *   })
 * })
 * const GitHubGraphQLGroup = GraphQLGroup.make(RepoIssues)
 *
 * class GitHub extends Context.Service<GitHub>()("app/GitHub", {
 *   make: GraphQLClient.make(GitHubGraphQLGroup)
 * }) {}
 *
 * const GitHubTest = Layer.succeed(
 *   GitHub,
 *   GraphQLClient.makeTest(GitHubGraphQLGroup)({
 *     RepoIssues: ({ name }) => Effect.succeed({ repository: { issues: { totalCount: name.length } } })
 *   })
 * )
 *
 * const program = GitHub.use((github) => github.RepoIssues({ owner: "Effect-TS", name: "effect" }))
 *
 * await Effect.runPromise(program.pipe(Effect.provide(GitHubTest))) // => { repository: { issues: { totalCount: 6 } } }
 * ```
 *
 * @stability experimental
 * @category testing
 * @since 4.0.0
 */
export const makeTest = group => handlers => {
  // Type boundary: the mapped type keys handlers by name, which a lookup by a
  // runtime name cannot follow.
  const byName = handlers;
  return fromGroup(group, operation => makeTestMethod(operation, Object.hasOwn(byName, operation.name) ? byName[operation.name] : undefined));
};
/**
 * Builds a mock layer for a client service using {@link makeTest}. Bind the
 * service and group once to expose a `layerTest(handlers)` helper on the service.
 * The group fixes the operation types before the handlers are checked.
 *
 * **Example** (Binding a mock layer to a client service)
 *
 * ```ts import.meta.vitest
 * import { Context, Effect, Schema } from "effect"
 * import { GraphQL, GraphQLClient, GraphQLGroup } from "effect/graphql"
 *
 * const RepoIssues = GraphQL.query("RepoIssues", {
 *   document: "query RepoIssues($owner:String!,$name:String!){repository(owner:$owner,name:$name){issues{totalCount}}}",
 *   variables: { owner: Schema.String, name: Schema.String },
 *   result: Schema.Struct({
 *     repository: Schema.NullOr(Schema.Struct({ issues: Schema.Struct({ totalCount: Schema.Int }) }))
 *   })
 * })
 * const GitHubGraphQLGroup = GraphQLGroup.make(RepoIssues)
 *
 * class GitHub extends Context.Service<GitHub>()("app/GitHub", {
 *   make: GraphQLClient.make(GitHubGraphQLGroup)
 * }) {
 *   static readonly layerTest = GraphQLClient.layerTest(GitHub, GitHubGraphQLGroup)
 * }
 *
 * const program = GitHub.use((github) => github.RepoIssues({ owner: "Effect-TS", name: "effect" }))
 *
 * await Effect.runPromise(program.pipe(Effect.provide(GitHub.layerTest({
 *   RepoIssues: ({ name }) => Effect.succeed({ repository: { issues: { totalCount: name.length } } })
 * })))) // => { repository: { issues: { totalCount: 6 } } }
 * ```
 *
 * @see {@link makeTest} for mock behavior and the middleware-services limitation.
 * @stability experimental
 * @category testing
 * @since 4.0.0
 */
export const layerTest = (service, group) => handlers =>
// The group constraint checks that the mock satisfies the service shape.
Layer.succeed(service, makeTest(group)(handlers));
const makeTestMethod = (operation, handler) => {
  const subscription = operation.kind === "subscription";
  if (handler === undefined) {
    const unimplemented = () => {
      const prevLimit = getStackTraceLimit();
      setStackTraceLimit(2);
      const error = new Error(`GraphQLClient: Unimplemented operation "${operation.name}"`);
      setStackTraceLimit(prevLimit);
      error.name = "UnimplementedError";
      return subscription ? Stream.die(error) : Effect.die(error);
    };
    return Object.assign(unimplemented, {
      operation
    });
  }
  const call = (variables, options) => {
    const run = () => handler(variables === undefined ? {} : variables, options ?? {});
    if (subscription) return Stream.suspend(run);
    const result = Effect.suspend(run);
    return options?.partial === true ? Effect.map(result, data => ({
      data,
      errors: []
    })) : result;
  };
  return Object.assign(call, {
    operation
  });
};
//# sourceMappingURL=GraphQLClient.js.map