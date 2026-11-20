import { type Pipeable } from "../Pipeable.ts";
import * as Schema from "../Schema.ts";
import type { GraphQLClientError } from "./GraphQLClientError.ts";
import type * as GraphQLMiddleware from "./GraphQLMiddleware.ts";
declare const TypeId = "~effect/graphql/GraphQL";
/**
 * The three kinds of GraphQL operation.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export type Kind = "query" | "mutation" | "subscription";
/**
 * An operation document split into the pieces needed to rename and alias it
 * without a GraphQL parser. The generator emits one for every query and
 * mutation.
 *
 * **Details**
 *
 * A `body` is a {@link DocumentTemplate.Parts} array: literal text at even
 * indices and, at odd indices, the variable names and fragment names that
 * would be renamed if the operation were repeated under a prefix. Joining the
 * pieces gives the printed document, which is what the operation sends.
 *
 * A fragment whose `body` has a name in it is per-slice: it references a
 * variable, directly or through a fragment it spreads. Every other fragment is
 * shared.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface DocumentTemplate {
    /** The variable definitions, in document order. */
    readonly variables: ReadonlyArray<DocumentTemplate.Variable>;
    /** The operation's directives, if it has any. */
    readonly directives?: DocumentTemplate.Parts | undefined;
    /** The root selections, in document order. */
    readonly selections: ReadonlyArray<DocumentTemplate.Selection>;
    /** The fragments the operation uses, in the order they follow it. */
    readonly fragments: ReadonlyArray<DocumentTemplate.Fragment>;
}
/**
 * The pieces of a {@link DocumentTemplate}.
 *
 * @stability experimental
 * @since 4.0.0
 */
export declare namespace DocumentTemplate {
    /**
     * Literal text at even indices and names to rename at odd indices.
     *
     * @stability experimental
     * @category models
     * @since 4.0.0
     */
    type Parts = ReadonlyArray<string>;
    /**
     * A variable definition: `$name:` followed by `body`, the type, default
     * value and directives as printed.
     *
     * @stability experimental
     * @category models
     * @since 4.0.0
     */
    interface Variable {
        readonly name: string;
        readonly body: string;
    }
    /**
     * A root selection. For a field, `body` is everything after its name and
     * the response key is `alias ?? name`. A fragment spread or inline fragment
     * has no `name`, and `body` is the whole selection.
     *
     * @stability experimental
     * @category models
     * @since 4.0.0
     */
    interface Selection {
        readonly alias?: string | undefined;
        readonly name?: string | undefined;
        readonly body: Parts;
    }
    /**
     * A fragment definition: `fragment` and `name`, followed by `body`, which
     * starts at its type condition.
     *
     * @stability experimental
     * @category models
     * @since 4.0.0
     */
    interface Fragment {
        readonly name: string;
        readonly body: Parts;
    }
}
/**
 * A named GraphQL document with variable and result schemas and middleware.
 * Variables are encoded before sending; results are decoded from `data`.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface Operation<out K extends Kind, out Name extends string, out Variables extends Schema.Top, out Result extends Schema.Top, out Middleware = never> extends Pipeable {
    readonly [TypeId]: typeof TypeId;
    readonly kind: K;
    readonly name: Name;
    /** The printed document, sent as-is. It is never parsed at runtime. */
    readonly document: string;
    /** The template the document was joined from, if it was given as one. */
    readonly template: DocumentTemplate | undefined;
    readonly variables: Variables;
    readonly result: Result;
    /** Middleware attached to this operation, outermost first. */
    readonly middlewares: ReadonlyArray<GraphQLMiddleware.AnyService>;
    readonly "~middleware"?: Middleware;
    /**
     * Returns a copy of this operation with `middleware` attached. Operation
     * middleware runs inside any group middleware; within the operation,
     * middleware run in the order they were attached.
     */
    middleware<M extends GraphQLMiddleware.AnyService>(middleware: M): Operation<K, Name, Variables, Result, Middleware | M>;
}
/**
 * Any operation, with its type parameters erased.
 *
 * @stability experimental
 * @category utility types
 * @since 4.0.0
 */
export type Any = Operation<Kind, string, Schema.Top, Schema.Top, any>;
/**
 * Extracts the union of middleware attached to an operation.
 *
 * @stability experimental
 * @category utility types
 * @since 4.0.0
 */
export type Middleware<Op> = Op extends Operation<any, any, any, any, infer M> ? M : never;
/**
 * The decoded variables type of an operation, which is what a client method
 * takes.
 *
 * @stability experimental
 * @category utility types
 * @since 4.0.0
 */
export type Variables<Op extends Any> = Op["variables"]["Type"];
/**
 * The decoded result type of an operation.
 *
 * @stability experimental
 * @category utility types
 * @since 4.0.0
 */
export type Result<Op extends Any> = Op["result"]["Type"];
/**
 * The error type of a client method for an operation: `GraphQLClientError`
 * plus the errors of every attached middleware.
 *
 * @stability experimental
 * @category utility types
 * @since 4.0.0
 */
export type Error<Op extends Any> = GraphQLClientError | GraphQLMiddleware.Error<Middleware<Op>>;
/**
 * The services a client method for an operation requires: the Schemas'
 * encoding and decoding services plus the requirements of every attached
 * middleware.
 *
 * @stability experimental
 * @category utility types
 * @since 4.0.0
 */
export type Services<Op extends Any> = Op["variables"]["EncodingServices"] | Op["result"]["DecodingServices"] | GraphQLMiddleware.Requires<Middleware<Op>>;
/**
 * The type of an operation after attaching middleware `M`.
 *
 * @stability experimental
 * @category utility types
 * @since 4.0.0
 */
export type AddMiddleware<Op, M> = Op extends Operation<infer K, infer N, infer V, infer R, infer Old> ? Operation<K, N, V, R, Old | M> : never;
/**
 * Tests whether a value is an {@link Operation}.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.0
 */
export declare const isOperation: (u: unknown) => u is Any;
/**
 * Defines a query. The client accepts decoded variables and encodes them
 * through their Schema, including custom scalar codecs. `variables` accepts
 * struct fields or a Schema; omit it for an operation without variables.
 * `document` accepts printed text or a {@link DocumentTemplate}, joined once
 * when the operation is defined.
 *
 * **Example** (A query with variables)
 *
 * ```ts import.meta.vitest
 * import { Schema } from "effect"
 * import { GraphQL } from "effect/graphql"
 *
 * const RepoIssues = GraphQL.query("RepoIssues", {
 *   document: "query RepoIssues($owner:String!,$name:String!){repository(owner:$owner,name:$name){issues(first:10){nodes{number title}}}}",
 *   variables: { owner: Schema.String, name: Schema.String },
 *   result: Schema.Struct({
 *     repository: Schema.NullOr(Schema.Struct({
 *       issues: Schema.Struct({
 *         nodes: Schema.NullOr(Schema.Array(Schema.NullOr(Schema.Struct({ number: Schema.Int, title: Schema.String }))))
 *       })
 *     }))
 *   })
 * })
 *
 * RepoIssues.kind // => "query"
 * RepoIssues.name // => "RepoIssues"
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export declare const query: <const Name extends string, Result extends Schema.Top, Variables extends Schema.Top | Schema.Struct.Fields = Schema.Struct<{}>>(name: Name, options: {
    readonly document: string | DocumentTemplate;
    readonly variables?: Variables | undefined;
    readonly result: Result;
}) => Operation<"query", Name, Variables extends Schema.Struct.Fields ? Schema.Struct<Variables> : Variables, Result>;
/**
 * Defines a mutation. Same shape as {@link query}.
 *
 * **Example** (A mutation)
 *
 * ```ts import.meta.vitest
 * import { Schema } from "effect"
 * import { GraphQL } from "effect/graphql"
 *
 * const AddComment = GraphQL.mutation("AddComment", {
 *   document: "mutation AddComment($subjectId:ID!,$body:String!){addComment(input:{subjectId:$subjectId,body:$body}){clientMutationId}}",
 *   variables: { subjectId: Schema.String, body: Schema.String },
 *   result: Schema.Struct({ addComment: Schema.NullOr(Schema.Struct({ clientMutationId: Schema.NullOr(Schema.String) })) })
 * })
 *
 * AddComment.kind // => "mutation"
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export declare const mutation: <const Name extends string, Result extends Schema.Top, Variables extends Schema.Top | Schema.Struct.Fields = Schema.Struct<{}>>(name: Name, options: {
    readonly document: string | DocumentTemplate;
    readonly variables?: Variables | undefined;
    readonly result: Result;
}) => Operation<"mutation", Name, Variables extends Schema.Struct.Fields ? Schema.Struct<Variables> : Variables, Result>;
/**
 * Defines a subscription. The client method for a subscription returns a
 * `Stream` of decoded events instead of an `Effect`.
 *
 * **Example** (A subscription)
 *
 * ```ts import.meta.vitest
 * import { Schema } from "effect"
 * import { GraphQL } from "effect/graphql"
 *
 * const IssueUpdated = GraphQL.subscription("IssueUpdated", {
 *   document: "subscription IssueUpdated($id:ID!){issueUpdated(id:$id){title}}",
 *   variables: { id: Schema.String },
 *   result: Schema.Struct({ issueUpdated: Schema.Struct({ title: Schema.String }) })
 * })
 *
 * IssueUpdated.kind // => "subscription"
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export declare const subscription: <const Name extends string, Result extends Schema.Top, Variables extends Schema.Top | Schema.Struct.Fields = Schema.Struct<{}>>(name: Name, options: {
    readonly document: string | DocumentTemplate;
    readonly variables?: Variables | undefined;
    readonly result: Result;
}) => Operation<"subscription", Name, Variables extends Schema.Struct.Fields ? Schema.Struct<Variables> : Variables, Result>;
/**
 * The `__typename` Schema for the "every other type" member of a generated
 * union.
 *
 * **Details**
 *
 * The type excludes selected names, allowing `__typename` narrowing. The
 * decoder accepts any other string, including types added by the server
 * later. Selected names are rejected so malformed selected results cannot
 * fall through to the catch-all member.
 *
 * **Example** (The catch-all member of a union)
 *
 * ```ts import.meta.vitest
 * import { Schema } from "effect"
 * import { GraphQL } from "effect/graphql"
 *
 * type Node = "Issue" | "PullRequest" | "Repository"
 *
 * const OtherNode = Schema.Struct({
 *   __typename: GraphQL.otherTypename<Node>()(["Issue"]),
 *   id: Schema.String
 * })
 *
 * Schema.decodeUnknownSync(OtherNode)({ __typename: "PullRequest", id: "1" }).__typename // => "PullRequest"
 * Schema.decodeUnknownSync(OtherNode)({ __typename: "AddedLater", id: "2" }).__typename // => "AddedLater"
 * Schema.is(OtherNode)({ __typename: "Issue", id: "3" }) // => false
 * ```
 *
 * @stability experimental
 * @category schemas
 * @since 4.0.0
 */
export declare const otherTypename: <All extends string>() => <const Selected extends ReadonlyArray<All>>(selected: Selected) => Schema.refine<Exclude<All, Selected[number]>, Schema.String>;
/**
 * The Schema for a GraphQL enum in a result position.
 *
 * **Details**
 *
 * It is typed as the declared literals but decodes any string, so a value the
 * server adds later does not fail the whole query. Inputs stay strict: the
 * generator uses `Schema.Literals` for enums in variables and input objects.
 *
 * **Example** (An enum that tolerates new values)
 *
 * ```ts import.meta.vitest
 * import { Schema } from "effect"
 * import { GraphQL } from "effect/graphql"
 *
 * const IssueState = GraphQL.enumLiterals(["OPEN", "CLOSED"])
 *
 * Schema.decodeUnknownSync(IssueState)("OPEN") // => "OPEN"
 * Schema.decodeUnknownSync(IssueState)("MERGED") // => "MERGED"
 * Schema.is(IssueState)(42) // => false
 * ```
 *
 * @stability experimental
 * @category schemas
 * @since 4.0.0
 */
export declare const enumLiterals: <const Literals extends ReadonlyArray<string>>(literals: Literals) => Schema.refine<Literals[number], Schema.String>;
export {};
//# sourceMappingURL=GraphQL.d.ts.map