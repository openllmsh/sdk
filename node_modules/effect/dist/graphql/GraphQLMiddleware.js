/**
 * GraphQL-level middleware provided as `Context.Service` implementations.
 * Middleware can rewrite requests and inspect raw results, including response
 * extensions and HTTP headers. Provide implementations with `Layer.succeed`
 * or `Layer.effect`.
 *
 * @stability experimental
 * @since 4.0.0
 */
import * as Context from "../Context.js";
import * as Effect from "../Effect.js";
import * as Stream from "../Stream.js";
const TypeId = "~effect/graphql/GraphQLMiddleware";
/**
 * Declares a middleware tag. `requires` are services the implementation needs
 * on every call, and `error` is what it can fail with; both show up on the
 * requirements and error type of every client method the middleware is
 * attached to.
 *
 * **Example** (An auth middleware that needs the current user)
 *
 * ```ts import.meta.vitest
 * import { Context, Effect, Layer, Schema, Stream } from "effect"
 * import { GraphQL, GraphQLClient, GraphQLGroup, GraphQLMiddleware, GraphQLProtocol } from "effect/graphql"
 * import { Headers } from "effect/http"
 *
 * class CurrentUser extends Context.Service<CurrentUser, { readonly token: string }>()("CurrentUser") {}
 * class TokenExpired extends Schema.TaggedError<TokenExpired>()("TokenExpired", {}) {}
 *
 * class Auth extends GraphQLMiddleware.Service<Auth, {
 *   requires: CurrentUser
 *   error: TokenExpired
 * }>()("app/Auth") {}
 *
 * const AuthLive = Layer.succeed(
 *   Auth,
 *   GraphQLMiddleware.mapRequest(Effect.fnUntraced(function*(request) {
 *     const user = yield* CurrentUser
 *     if (user.token === "") return yield* new TokenExpired()
 *     return { ...request, headers: Headers.set(request.headers, "authorization", `Bearer ${user.token}`) }
 *   }))
 * )
 *
 * const Viewer = GraphQL.query("Viewer", {
 *   document: "query Viewer{viewer{login}}",
 *   result: Schema.Struct({ viewer: Schema.Struct({ login: Schema.String }) })
 * })
 *
 * const Scripted = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
 *   execute: (request) => Effect.succeed({ body: { data: { viewer: { login: request.headers.authorization } } } }),
 *   subscribe: () => Stream.empty
 * })
 *
 * const program = Effect.gen(function*() {
 *   const client = yield* GraphQLClient.make(GraphQLGroup.make(Viewer).middleware(Auth))
 *   // CurrentUser is required by the method because Auth is attached
 *   return yield* client.Viewer().pipe(Effect.provideService(CurrentUser, { token: "abc" }))
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provide([Scripted, AuthLive]))) // => { viewer: { login: "Bearer abc" } }
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export const Service = () => key => {
  function ServiceClass() {}
  Object.setPrototypeOf(ServiceClass, Object.getPrototypeOf(Context.Service(key)));
  return Object.assign(ServiceClass, {
    key,
    [TypeId]: TypeId
  });
};
/**
 * Builds an {@link Implementation} that transforms requests for queries,
 * mutations and subscriptions. Use it to set headers, auth or extensions.
 *
 * **Example** (Adding a header to every request)
 *
 * ```ts import.meta.vitest
 * import { Effect, Layer, Schema, Stream } from "effect"
 * import { GraphQL, GraphQLClient, GraphQLGroup, GraphQLMiddleware, GraphQLProtocol } from "effect/graphql"
 * import { Headers } from "effect/http"
 *
 * class RequestId extends GraphQLMiddleware.Service<RequestId>()("app/RequestId") {}
 *
 * const RequestIdLive = Layer.succeed(
 *   RequestId,
 *   GraphQLMiddleware.mapRequest((request) =>
 *     Effect.succeed({ ...request, headers: Headers.set(request.headers, "x-request-id", "abc") })
 *   )
 * )
 *
 * const Viewer = GraphQL.query("Viewer", {
 *   document: "query Viewer{viewer{login}}",
 *   result: Schema.Struct({ viewer: Schema.Struct({ login: Schema.String }) })
 * })
 *
 * const Scripted = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
 *   execute: (request) =>
 *     Effect.succeed({ body: { data: { viewer: { login: request.headers["x-request-id"] } } } }),
 *   subscribe: () => Stream.empty
 * })
 *
 * const program = Effect.gen(function*() {
 *   const client = yield* GraphQLClient.make(GraphQLGroup.make(Viewer).middleware(RequestId))
 *   return yield* client.Viewer()
 * })
 *
 * await Effect.runPromise(program.pipe(Effect.provide([Scripted, RequestIdLive]))) // => { viewer: { login: "abc" } }
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export const mapRequest = f => ({
  execute: ({
    next,
    operation,
    request
  }) => Effect.flatMap(f(request, operation), next),
  subscribe: ({
    next,
    operation,
    request
  }) => Stream.unwrap(Effect.map(f(request, operation), next))
});
//# sourceMappingURL=GraphQLMiddleware.js.map