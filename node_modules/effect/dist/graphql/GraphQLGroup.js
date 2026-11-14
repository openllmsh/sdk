/**
 * Groups of GraphQL operations, merged to build a client. Group middleware
 * runs outside operation middleware. `@effect/graphql-generator` emits one
 * group per document file.
 *
 * @stability experimental
 * @since 4.0.0
 */
import { pipeArguments } from "../Pipeable.js";
import { hasProperty } from "../Predicate.js";
const TypeId = "~effect/graphql/GraphQLGroup";
/**
 * Tests whether a value is a {@link GraphQLGroup}.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.0
 */
export const isGraphQLGroup = u => hasProperty(u, TypeId);
const Proto = {
  [TypeId]: TypeId,
  pipe() {
    return pipeArguments(this, arguments);
  },
  middleware(middleware) {
    return makeProto(this.operations, [...this.middlewares, middleware]);
  }
};
// The operation and middleware types of a group are phantom: at runtime a
// group holds erased `GraphQL.Any` operations and `AnyService` tags, so the
// typed constructors below state their group type with one assertion each.
const makeProto = (operations, middlewares) => {
  const byName = new Map();
  for (const operation of operations) {
    const existing = byName.get(operation.name);
    if (existing !== undefined && existing !== operation) {
      throw new Error(`GraphQLGroup: duplicate operation name "${operation.name}"`);
    }
    byName.set(operation.name, operation);
  }
  return Object.assign(Object.create(Proto), {
    operations: Array.from(byName.values()),
    middlewares
  });
};
/**
 * Builds a group from operations. Operation names must be unique within a
 * group, because they become the client's method names.
 *
 * **Example** (One group per `.graphql` file)
 *
 * ```ts import.meta.vitest
 * import { Schema } from "effect"
 * import { GraphQL, GraphQLGroup } from "effect/graphql"
 *
 * const Viewer = GraphQL.query("Viewer", {
 *   document: "query Viewer{viewer{login}}",
 *   result: Schema.Struct({ viewer: Schema.Struct({ login: Schema.String }) })
 * })
 *
 * const ViewerGraphQLGroup = GraphQLGroup.make(Viewer)
 *
 * ViewerGraphQLGroup.operations.map((op) => op.name) // => ["Viewer"]
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export const make = (...operations) => makeProto(operations, []);
/**
 * Merges groups into one. Middleware attached to a source group stays
 * attached to that group's operations; middleware attached to the merged
 * group afterwards runs outside all of it.
 *
 * **Example** (Auth on one file, logging on everything)
 *
 * ```ts import.meta.vitest
 * import { Schema } from "effect"
 * import { GraphQL, GraphQLGroup, GraphQLMiddleware } from "effect/graphql"
 *
 * class Auth extends GraphQLMiddleware.Service<Auth>()("app/Auth") {}
 * class Logging extends GraphQLMiddleware.Service<Logging>()("app/Logging") {}
 *
 * const Viewer = GraphQL.query("Viewer", {
 *   document: "query Viewer{viewer{login}}",
 *   result: Schema.Struct({ viewer: Schema.Struct({ login: Schema.String }) })
 * })
 * const Rate = GraphQL.query("Rate", {
 *   document: "query Rate{rateLimit{remaining}}",
 *   result: Schema.Struct({ rateLimit: Schema.Struct({ remaining: Schema.Int }) })
 * })
 *
 * const all = GraphQLGroup.merge(GraphQLGroup.make(Viewer).middleware(Auth), GraphQLGroup.make(Rate))
 *   .middleware(Logging)
 *
 * all.operations.map((op) => op.name) // => ["Viewer", "Rate"]
 * all.middlewares.map((m) => m.key) // => ["app/Logging"]
 * all.operations[0].middlewares.map((m) => m.key) // => ["app/Auth"]
 * ```
 *
 * @stability experimental
 * @category combinators
 * @since 4.0.0
 */
export const merge = (...groups) => makeProto(groups.flatMap(group => group.middlewares.length === 0 ? group.operations : group.operations.map(operation => Object.assign(Object.create(Object.getPrototypeOf(operation)), operation, {
  middlewares: [...group.middlewares, ...operation.middlewares]
}))), []);
//# sourceMappingURL=GraphQLGroup.js.map