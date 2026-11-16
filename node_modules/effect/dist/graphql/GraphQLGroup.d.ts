/**
 * Groups of GraphQL operations, merged to build a client. Group middleware
 * runs outside operation middleware. `@effect/graphql-generator` emits one
 * group per document file.
 *
 * @stability experimental
 * @since 4.0.0
 */
import { type Pipeable } from "../Pipeable.ts";
import type * as GraphQL from "./GraphQL.ts";
import type * as GraphQLMiddleware from "./GraphQLMiddleware.ts";
declare const TypeId = "~effect/graphql/GraphQLGroup";
/**
 * A set of operations plus the middleware attached at the group level.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface GraphQLGroup<out Ops extends GraphQL.Any> extends Pipeable {
    readonly [TypeId]: typeof TypeId;
    readonly operations: ReadonlyArray<Ops>;
    /** Middleware attached to the group, outermost first. */
    readonly middlewares: ReadonlyArray<GraphQLMiddleware.AnyService>;
    /**
     * Attaches a middleware to every operation in the group. Group middleware
     * runs outside operation middleware; several group middleware run in the
     * order attached.
     */
    middleware<M extends GraphQLMiddleware.AnyService>(middleware: M): GraphQLGroup<GraphQL.AddMiddleware<Ops, M>>;
}
/**
 * Any group, with its operations erased.
 *
 * @stability experimental
 * @category utility types
 * @since 4.0.0
 */
export type Any = GraphQLGroup<GraphQL.Any>;
/**
 * Extracts the union of operations in a group.
 *
 * @stability experimental
 * @category utility types
 * @since 4.0.0
 */
export type Operations<G> = G extends GraphQLGroup<infer Ops> ? Ops : never;
/**
 * Tests whether a value is a {@link GraphQLGroup}.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.0
 */
export declare const isGraphQLGroup: (u: unknown) => u is Any;
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
export declare const make: <const Ops extends ReadonlyArray<GraphQL.Any>>(...operations: Ops) => GraphQLGroup<Ops[number]>;
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
export declare const merge: <const Groups extends ReadonlyArray<Any>>(...groups: Groups) => GraphQLGroup<Operations<Groups[number]>>;
export {};
//# sourceMappingURL=GraphQLGroup.d.ts.map