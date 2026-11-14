import * as Equal from "./Equal.ts";
import * as Equ from "./Equivalence.ts";
import { type Inspectable } from "./Inspectable.ts";
import * as Option from "./Option.ts";
import * as order from "./Order.ts";
import { type Pipeable } from "./Pipeable.ts";
import * as Result from "./Result.ts";
declare const TypeId = "~effect/SemVer";
declare const SemVerErrorTypeId = "~effect/SemVer/SemVerError";
/**
 * Represents a semantic version.
 *
 * **Details**
 *
 * Pre-release identifiers are numbers when they consist only of digits and
 * strings otherwise. Build metadata identifiers are always strings because
 * they may contain leading zeros. Both arrays are empty when absent.
 *
 * **Example** (Reading version components)
 *
 * ```ts import.meta.vitest
 * import { SemVer } from "effect"
 *
 * const version = SemVer.parseUnsafe("1.2.3-rc.1+build.5")
 *
 * version.minor // => 2
 * version.prerelease // => ["rc", 1]
 * version.build // => ["build", "5"]
 * ```
 *
 * @see {@link parse} for decoding version strings
 * @see {@link make} for constructing versions from components
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface SemVer extends Pipeable, Equal.Equal, Inspectable {
    readonly [TypeId]: typeof TypeId;
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly prerelease: ReadonlyArray<string | number>;
    readonly build: ReadonlyArray<string>;
}
declare const SemVerError_base: new <A extends Record<string, any> = {}>(args: import("./Types.ts").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("./Cause.ts").YieldableError & {
    readonly _tag: "SemVerError";
} & Readonly<A>;
/**
 * Error raised for invalid version strings, ranges, or components.
 *
 * @see {@link isSemVerError} for narrowing unknown values
 * @stability unstable
 * @category errors
 * @since 4.0.6
 */
export declare class SemVerError extends SemVerError_base<{
    readonly message: string;
    readonly input?: string;
}> {
    readonly [SemVerErrorTypeId]: typeof SemVerErrorTypeId;
}
/**
 * Checks whether a value is a `SemVerError`.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.6
 */
export declare const isSemVerError: (u: unknown) => u is SemVerError;
/**
 * Checks whether a value is a `SemVer`.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.6
 */
export declare const isSemVer: (u: unknown) => u is SemVer;
/**
 * The numeric components and identifiers of a version.
 *
 * @see {@link make} for validating components into a version
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface Components {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly prerelease?: ReadonlyArray<string | number> | undefined;
    readonly build?: ReadonlyArray<string> | undefined;
}
type NumericComponent = "0" | (`${bigint}` & `${"1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"}${string}`);
/**
 * Version string literals accepted by `fromInput`.
 *
 * **Details**
 *
 * Requires three numeric components without signs or leading zeros, followed
 * by an optional `-` pre-release and `+` build suffix. Component magnitudes
 * (at most `Number.MAX_SAFE_INTEGER`) and identifiers are only validated at
 * runtime.
 *
 * @see {@link parse} for arbitrary strings
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type VersionString = `${NumericComponent}.${NumericComponent}.${NumericComponent}${"" | `-${string}` | `+${string}`}`;
/**
 * Values accepted by `fromInput`: a version, a version string literal, or
 * version components.
 *
 * @see {@link fromInput} for converting inputs
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type Input = SemVer | VersionString | Components;
/**
 * Creates a version from its components and throws `SemVerError` for invalid
 * components.
 *
 * **Details**
 *
 * Components must be non-negative safe integers. Identifiers must be non-empty
 * and contain only ASCII alphanumerics and hyphens. Digit-only pre-release
 * strings are normalized to numbers and must not have leading zeros.
 *
 * A `SemVer` spreads into exactly these components, so `make({ ...version,
 * patch: version.patch + 1 })` derives a validated version from an existing
 * one.
 *
 * **Example** (Creating a pre-release version)
 *
 * ```ts import.meta.vitest
 * import { SemVer } from "effect"
 *
 * SemVer.format(SemVer.make({ major: 1, minor: 0, patch: 0, prerelease: ["beta", "2"] })) // => "1.0.0-beta.2"
 * ```
 *
 * @see {@link parse} for decoding version strings
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const make: (components: Components) => SemVer;
/**
 * Parses a strict Semantic Versioning 2.0.0 string.
 *
 * **Details**
 *
 * The input must match the spec grammar exactly. Leading zeros in numeric
 * components or pre-release identifiers, empty identifiers, and numbers above
 * `Number.MAX_SAFE_INTEGER` are rejected.
 *
 * **Gotchas**
 *
 * A `v` prefix, surrounding whitespace, and partial versions such as `1.2` are
 * rejected because they are not semantic versions.
 *
 * **Example** (Parsing version strings)
 *
 * ```ts import.meta.vitest
 * import { Result, SemVer } from "effect"
 *
 * Result.isSuccess(SemVer.parse("1.2.3-alpha.1+001")) // => true
 * Result.isFailure(SemVer.parse("v1.2.3")) // => true
 * ```
 *
 * @see {@link parseUnsafe} for throwing on invalid input
 * @see {@link format} for the inverse operation
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const parse: (input: string) => Result.Result<SemVer, SemVerError>;
/**
 * Parses a strict Semantic Versioning 2.0.0 string and throws `SemVerError`
 * for invalid input.
 *
 * @see {@link parse} for non-throwing parsing
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const parseUnsafe: (input: string) => SemVer;
/**
 * Converts a version, version string, or version components into a `SemVer`.
 *
 * **Details**
 *
 * Versions are returned unchanged, strings are parsed like {@link parse}, and
 * components are validated like {@link make}. Invalid input fails with
 * `SemVerError`.
 *
 * **Example** (Accepting flexible version input)
 *
 * ```ts import.meta.vitest
 * import { Result, SemVer } from "effect"
 *
 * Result.map(SemVer.fromInput("1.2.3-rc.1"), SemVer.format) // => Result.succeed("1.2.3-rc.1")
 * Result.map(SemVer.fromInput({ major: 1, minor: 2, patch: 3 }), SemVer.format) // => Result.succeed("1.2.3")
 * Result.isFailure(SemVer.fromInput({ major: -1, minor: 0, patch: 0 })) // => true
 * ```
 *
 * @see {@link fromInputUnsafe} for throwing on invalid input
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const fromInput: (input: Input) => Result.Result<SemVer, SemVerError>;
/**
 * Converts a version, version string, or version components into a `SemVer`
 * and throws `SemVerError` for invalid input.
 *
 * @see {@link fromInput} for non-throwing conversion
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const fromInputUnsafe: (input: Input) => SemVer;
/**
 * Formats a version as its canonical string, including pre-release identifiers
 * and build metadata.
 *
 * @see {@link parse} for the inverse operation
 * @stability unstable
 * @category converting
 * @since 4.0.6
 */
export declare const format: (self: SemVer) => string;
/**
 * Checks whether a version has pre-release identifiers.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export declare const isPrerelease: (self: SemVer) => boolean;
/**
 * Checks whether a version has build metadata.
 *
 * **Details**
 *
 * Build metadata does not affect precedence, but it is part of structural
 * equality.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export declare const hasBuild: (self: SemVer) => boolean;
/**
 * Checks whether a version is in initial development, meaning its major
 * version is `0`.
 *
 * **Details**
 *
 * The SemVer spec treats `0.y.z` as initial development where anything may
 * change at any time and the public API should not be considered stable.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export declare const isInitialDevelopment: (self: SemVer) => boolean;
/**
 * Orders versions by Semantic Versioning precedence.
 *
 * **Details**
 *
 * Major, minor, and patch are compared numerically. A pre-release has lower
 * precedence than its release. Pre-release identifiers are compared left to
 * right: numeric identifiers compare numerically and sort before alphanumeric
 * identifiers, which compare in ASCII order. A longer list of otherwise equal
 * identifiers has higher precedence.
 *
 * **Gotchas**
 *
 * Build metadata is ignored, so versions that differ only in build metadata
 * compare as `0` even though they are not `Equal`.
 *
 * **Example** (Sorting by precedence)
 *
 * ```ts import.meta.vitest
 * import { Array, SemVer } from "effect"
 *
 * const versions = ["1.0.0", "1.0.0-rc.1", "1.0.0-beta.11", "1.0.0-beta.2", "1.0.0-alpha"].map(SemVer.parseUnsafe)
 *
 * Array.sort(versions, SemVer.Order).map(SemVer.format) // => ["1.0.0-alpha", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"]
 * ```
 *
 * @see {@link Equivalence} for structural equality including build metadata
 * @stability unstable
 * @category instances
 * @since 4.0.6
 */
export declare const Order: order.Order<SemVer>;
/**
 * Provides structural equivalence for versions, including build metadata.
 *
 * @see {@link Order} for precedence that ignores build metadata
 * @stability unstable
 * @category instances
 * @since 4.0.6
 */
export declare const Equivalence: Equ.Equivalence<SemVer>;
/**
 * Checks whether two versions are structurally equal, including build
 * metadata.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export declare const equals: {
    /**
     * Checks whether two versions are structurally equal, including build
     * metadata.
     *
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (that: SemVer): (self: SemVer) => boolean;
    /**
     * Checks whether two versions are structurally equal, including build
     * metadata.
     *
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (self: SemVer, that: SemVer): boolean;
};
/**
 * Checks whether the first version has lower precedence than the second.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export declare const isLessThan: {
    /**
     * Checks whether the first version has lower precedence than the second.
     *
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (that: SemVer): (self: SemVer) => boolean;
    /**
     * Checks whether the first version has lower precedence than the second.
     *
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (self: SemVer, that: SemVer): boolean;
};
/**
 * Checks whether the first version has lower or equal precedence than the
 * second.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export declare const isLessThanOrEqualTo: {
    /**
     * Checks whether the first version has lower or equal precedence than the
     * second.
     *
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (that: SemVer): (self: SemVer) => boolean;
    /**
     * Checks whether the first version has lower or equal precedence than the
     * second.
     *
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (self: SemVer, that: SemVer): boolean;
};
/**
 * Checks whether the first version has higher precedence than the second.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export declare const isGreaterThan: {
    /**
     * Checks whether the first version has higher precedence than the second.
     *
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (that: SemVer): (self: SemVer) => boolean;
    /**
     * Checks whether the first version has higher precedence than the second.
     *
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (self: SemVer, that: SemVer): boolean;
};
/**
 * Checks whether the first version has higher or equal precedence than the
 * second.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export declare const isGreaterThanOrEqualTo: {
    /**
     * Checks whether the first version has higher or equal precedence than the
     * second.
     *
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (that: SemVer): (self: SemVer) => boolean;
    /**
     * Checks whether the first version has higher or equal precedence than the
     * second.
     *
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (self: SemVer, that: SemVer): boolean;
};
/**
 * Checks whether a version's precedence is within an inclusive range.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export declare const between: {
    /**
     * Checks whether a version's precedence is within an inclusive range.
     *
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (options: {
        minimum: SemVer;
        maximum: SemVer;
    }): (self: SemVer) => boolean;
    /**
     * Checks whether a version's precedence is within an inclusive range.
     *
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (self: SemVer, options: {
        minimum: SemVer;
        maximum: SemVer;
    }): boolean;
};
/**
 * Returns the version with lower precedence, preferring the first on ties.
 *
 * @stability unstable
 * @category ordering
 * @since 4.0.6
 */
export declare const min: {
    /**
     * Returns the version with lower precedence, preferring the first on ties.
     *
     * @stability unstable
     * @category ordering
     * @since 4.0.6
     */
    (that: SemVer): (self: SemVer) => SemVer;
    /**
     * Returns the version with lower precedence, preferring the first on ties.
     *
     * @stability unstable
     * @category ordering
     * @since 4.0.6
     */
    (self: SemVer, that: SemVer): SemVer;
};
/**
 * Returns the version with higher precedence, preferring the first on ties.
 *
 * @stability unstable
 * @category ordering
 * @since 4.0.6
 */
export declare const max: {
    /**
     * Returns the version with higher precedence, preferring the first on ties.
     *
     * @stability unstable
     * @category ordering
     * @since 4.0.6
     */
    (that: SemVer): (self: SemVer) => SemVer;
    /**
     * Returns the version with higher precedence, preferring the first on ties.
     *
     * @stability unstable
     * @category ordering
     * @since 4.0.6
     */
    (self: SemVer, that: SemVer): SemVer;
};
/**
 * Constrains a version's precedence to an inclusive range.
 *
 * @stability unstable
 * @category ordering
 * @since 4.0.6
 */
export declare const clamp: {
    /**
     * Constrains a version's precedence to an inclusive range.
     *
     * @stability unstable
     * @category ordering
     * @since 4.0.6
     */
    (options: {
        minimum: SemVer;
        maximum: SemVer;
    }): (self: SemVer) => SemVer;
    /**
     * Constrains a version's precedence to an inclusive range.
     *
     * @stability unstable
     * @category ordering
     * @since 4.0.6
     */
    (self: SemVer, options: {
        minimum: SemVer;
        maximum: SemVer;
    }): SemVer;
};
/**
 * Replaces the pre-release identifiers of a version and throws `SemVerError`
 * for invalid identifiers.
 *
 * **Details**
 *
 * Digit-only strings are normalized to numbers. An empty array removes the
 * pre-release. Build metadata is preserved.
 *
 * @stability unstable
 * @category transforming
 * @since 4.0.6
 */
export declare const withPrerelease: {
    /**
     * Replaces the pre-release identifiers of a version and throws `SemVerError`
     * for invalid identifiers.
     *
     * **Details**
     *
     * Digit-only strings are normalized to numbers. An empty array removes the
     * pre-release. Build metadata is preserved.
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (prerelease: ReadonlyArray<string | number>): (self: SemVer) => SemVer;
    /**
     * Replaces the pre-release identifiers of a version and throws `SemVerError`
     * for invalid identifiers.
     *
     * **Details**
     *
     * Digit-only strings are normalized to numbers. An empty array removes the
     * pre-release. Build metadata is preserved.
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (self: SemVer, prerelease: ReadonlyArray<string | number>): SemVer;
};
/**
 * Replaces the build metadata of a version and throws `SemVerError` for
 * invalid identifiers.
 *
 * **Details**
 *
 * An empty array removes the build metadata. Pre-release identifiers are
 * preserved.
 *
 * @stability unstable
 * @category transforming
 * @since 4.0.6
 */
export declare const withBuild: {
    /**
     * Replaces the build metadata of a version and throws `SemVerError` for
     * invalid identifiers.
     *
     * **Details**
     *
     * An empty array removes the build metadata. Pre-release identifiers are
     * preserved.
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (build: ReadonlyArray<string>): (self: SemVer) => SemVer;
    /**
     * Replaces the build metadata of a version and throws `SemVerError` for
     * invalid identifiers.
     *
     * **Details**
     *
     * An empty array removes the build metadata. Pre-release identifiers are
     * preserved.
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (self: SemVer, build: ReadonlyArray<string>): SemVer;
};
/**
 * Removes pre-release identifiers and build metadata from a version.
 *
 * **Example** (Finalizing a release candidate)
 *
 * ```ts import.meta.vitest
 * import { SemVer } from "effect"
 *
 * SemVer.format(SemVer.release(SemVer.parseUnsafe("2.0.0-rc.3+sha.5114f85"))) // => "2.0.0"
 * ```
 *
 * @stability unstable
 * @category transforming
 * @since 4.0.6
 */
export declare const release: (self: SemVer) => SemVer;
/**
 * Returns the next major release.
 *
 * **Details**
 *
 * Returns the smallest major release with higher precedence, so a pre-release
 * of a major version, such as `2.0.0-rc.1`, becomes `2.0.0`. Pre-release
 * identifiers and build metadata are removed.
 *
 * **Example** (Bumping major versions)
 *
 * ```ts import.meta.vitest
 * import { SemVer } from "effect"
 *
 * SemVer.format(SemVer.bumpMajor(SemVer.parseUnsafe("1.2.3"))) // => "2.0.0"
 * SemVer.format(SemVer.bumpMajor(SemVer.parseUnsafe("2.0.0-rc.1"))) // => "2.0.0"
 * SemVer.format(SemVer.bumpMajor(SemVer.parseUnsafe("2.1.0-rc.1"))) // => "3.0.0"
 * ```
 *
 * @stability unstable
 * @category transforming
 * @since 4.0.6
 */
export declare const bumpMajor: (self: SemVer) => SemVer;
/**
 * Returns the next minor release.
 *
 * **Details**
 *
 * Returns the smallest minor release with higher precedence, so a pre-release
 * of a minor version, such as `1.3.0-rc.1`, becomes `1.3.0`. Pre-release
 * identifiers and build metadata are removed.
 *
 * @stability unstable
 * @category transforming
 * @since 4.0.6
 */
export declare const bumpMinor: (self: SemVer) => SemVer;
/**
 * Returns the next patch release.
 *
 * **Details**
 *
 * Returns the smallest patch release with higher precedence, so a pre-release
 * such as `1.2.3-rc.1` becomes `1.2.3`. Pre-release identifiers and build
 * metadata are removed.
 *
 * @stability unstable
 * @category transforming
 * @since 4.0.6
 */
export declare const bumpPatch: (self: SemVer) => SemVer;
/**
 * Returns the first pre-release of the next major version.
 *
 * **Details**
 *
 * Increments major, resets minor and patch, and starts the pre-release at
 * `[identifier, 0]`, or `[0]` without an identifier. Build metadata is removed.
 *
 * @stability unstable
 * @category transforming
 * @since 4.0.6
 */
export declare const bumpPremajor: {
    /**
     * Returns the first pre-release of the next major version.
     *
     * **Details**
     *
     * Increments major, resets minor and patch, and starts the pre-release at
     * `[identifier, 0]`, or `[0]` without an identifier. Build metadata is removed.
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (identifier?: string): (self: SemVer) => SemVer;
    /**
     * Returns the first pre-release of the next major version.
     *
     * **Details**
     *
     * Increments major, resets minor and patch, and starts the pre-release at
     * `[identifier, 0]`, or `[0]` without an identifier. Build metadata is removed.
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (self: SemVer, identifier?: string): SemVer;
};
/**
 * Returns the first pre-release of the next minor version.
 *
 * **Details**
 *
 * Increments minor, resets patch, and starts the pre-release at
 * `[identifier, 0]`, or `[0]` without an identifier. Build metadata is removed.
 *
 * @stability unstable
 * @category transforming
 * @since 4.0.6
 */
export declare const bumpPreminor: {
    /**
     * Returns the first pre-release of the next minor version.
     *
     * **Details**
     *
     * Increments minor, resets patch, and starts the pre-release at
     * `[identifier, 0]`, or `[0]` without an identifier. Build metadata is removed.
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (identifier?: string): (self: SemVer) => SemVer;
    /**
     * Returns the first pre-release of the next minor version.
     *
     * **Details**
     *
     * Increments minor, resets patch, and starts the pre-release at
     * `[identifier, 0]`, or `[0]` without an identifier. Build metadata is removed.
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (self: SemVer, identifier?: string): SemVer;
};
/**
 * Returns the first pre-release of the next patch version.
 *
 * **Details**
 *
 * Increments patch and starts the pre-release at `[identifier, 0]`, or `[0]`
 * without an identifier. Build metadata is removed.
 *
 * @stability unstable
 * @category transforming
 * @since 4.0.6
 */
export declare const bumpPrepatch: {
    /**
     * Returns the first pre-release of the next patch version.
     *
     * **Details**
     *
     * Increments patch and starts the pre-release at `[identifier, 0]`, or `[0]`
     * without an identifier. Build metadata is removed.
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (identifier?: string): (self: SemVer) => SemVer;
    /**
     * Returns the first pre-release of the next patch version.
     *
     * **Details**
     *
     * Increments patch and starts the pre-release at `[identifier, 0]`, or `[0]`
     * without an identifier. Build metadata is removed.
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (self: SemVer, identifier?: string): SemVer;
};
/**
 * Returns the next pre-release.
 *
 * **Details**
 *
 * - A release starts the pre-release of the next patch, like
 *   {@link bumpPrepatch}.
 * - An identifier that differs from the first pre-release identifier restarts
 *   the pre-release at `[identifier, 0]`.
 * - Otherwise the right-most numeric identifier is incremented, or `0` is
 *   appended when there is none.
 *
 * Build metadata is removed.
 *
 * **Gotchas**
 *
 * Switching to an identifier that sorts lower, such as from `beta` to `alpha`,
 * returns a version with lower precedence.
 *
 * **Example** (Advancing pre-releases)
 *
 * ```ts import.meta.vitest
 * import { SemVer } from "effect"
 *
 * SemVer.format(SemVer.bumpPrerelease(SemVer.parseUnsafe("1.2.3"), "alpha")) // => "1.2.4-alpha.0"
 * SemVer.format(SemVer.bumpPrerelease(SemVer.parseUnsafe("1.2.4-alpha.0"))) // => "1.2.4-alpha.1"
 * SemVer.format(SemVer.bumpPrerelease(SemVer.parseUnsafe("1.2.4-alpha.1"), "beta")) // => "1.2.4-beta.0"
 * ```
 *
 * @stability unstable
 * @category transforming
 * @since 4.0.6
 */
export declare const bumpPrerelease: {
    /**
     * Returns the next pre-release.
     *
     * **Details**
     *
     * - A release starts the pre-release of the next patch, like
     *   {@link bumpPrepatch}.
     * - An identifier that differs from the first pre-release identifier restarts
     *   the pre-release at `[identifier, 0]`.
     * - Otherwise the right-most numeric identifier is incremented, or `0` is
     *   appended when there is none.
     *
     * Build metadata is removed.
     *
     * **Gotchas**
     *
     * Switching to an identifier that sorts lower, such as from `beta` to `alpha`,
     * returns a version with lower precedence.
     *
     * **Example** (Advancing pre-releases)
     *
     * ```ts import.meta.vitest
     * import { SemVer } from "effect"
     *
     * SemVer.format(SemVer.bumpPrerelease(SemVer.parseUnsafe("1.2.3"), "alpha")) // => "1.2.4-alpha.0"
     * SemVer.format(SemVer.bumpPrerelease(SemVer.parseUnsafe("1.2.4-alpha.0"))) // => "1.2.4-alpha.1"
     * SemVer.format(SemVer.bumpPrerelease(SemVer.parseUnsafe("1.2.4-alpha.1"), "beta")) // => "1.2.4-beta.0"
     * ```
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (identifier?: string): (self: SemVer) => SemVer;
    /**
     * Returns the next pre-release.
     *
     * **Details**
     *
     * - A release starts the pre-release of the next patch, like
     *   {@link bumpPrepatch}.
     * - An identifier that differs from the first pre-release identifier restarts
     *   the pre-release at `[identifier, 0]`.
     * - Otherwise the right-most numeric identifier is incremented, or `0` is
     *   appended when there is none.
     *
     * Build metadata is removed.
     *
     * **Gotchas**
     *
     * Switching to an identifier that sorts lower, such as from `beta` to `alpha`,
     * returns a version with lower precedence.
     *
     * **Example** (Advancing pre-releases)
     *
     * ```ts import.meta.vitest
     * import { SemVer } from "effect"
     *
     * SemVer.format(SemVer.bumpPrerelease(SemVer.parseUnsafe("1.2.3"), "alpha")) // => "1.2.4-alpha.0"
     * SemVer.format(SemVer.bumpPrerelease(SemVer.parseUnsafe("1.2.4-alpha.0"))) // => "1.2.4-alpha.1"
     * SemVer.format(SemVer.bumpPrerelease(SemVer.parseUnsafe("1.2.4-alpha.1"), "beta")) // => "1.2.4-beta.0"
     * ```
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (self: SemVer, identifier?: string): SemVer;
};
/**
 * Names of version changes, matching npm's release types.
 *
 * @see {@link difference} for classifying the change between two versions
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type ReleaseType = "major" | "premajor" | "minor" | "preminor" | "patch" | "prepatch" | "prerelease";
/**
 * Bumps a version by release type.
 *
 * **When to use**
 *
 * Use when the release type is data, such as a CLI argument, configuration, or
 * the result of {@link difference}.
 *
 * **Details**
 *
 * Dispatches to {@link bumpMajor}, {@link bumpMinor}, {@link bumpPatch},
 * {@link bumpPremajor}, {@link bumpPreminor}, {@link bumpPrepatch}, or
 * {@link bumpPrerelease}, with the same semantics.
 *
 * **Gotchas**
 *
 * The pre-release `identifier` is ignored for `"major"`, `"minor"`, and
 * `"patch"`.
 *
 * **Example** (Bumping by a release type from input)
 *
 * ```ts import.meta.vitest
 * import { SemVer } from "effect"
 *
 * const version = SemVer.parseUnsafe("1.2.3")
 *
 * SemVer.format(SemVer.bump(version, "minor")) // => "1.3.0"
 * SemVer.format(SemVer.bump(version, "premajor", "rc")) // => "2.0.0-rc.0"
 * ```
 *
 * **Example** (Defining custom bump rules)
 *
 * ```ts import.meta.vitest
 * import { SemVer } from "effect"
 *
 * // Always increment patch, even for pre-releases, and keep build metadata
 * const customBump = (version: SemVer.SemVer, releaseType: SemVer.ReleaseType): SemVer.SemVer =>
 *   releaseType === "patch"
 *     ? SemVer.make({ ...version, patch: version.patch + 1, prerelease: [] })
 *     : SemVer.withBuild(SemVer.bump(version, releaseType), version.build)
 *
 * SemVer.format(customBump(SemVer.parseUnsafe("1.2.3-rc.1+b"), "patch")) // => "1.2.4+b"
 * SemVer.format(customBump(SemVer.parseUnsafe("1.2.3-rc.1+b"), "minor")) // => "1.3.0+b"
 * ```
 *
 * @stability unstable
 * @category transforming
 * @since 4.0.6
 */
export declare const bump: {
    /**
     * Bumps a version by release type.
     *
     * **When to use**
     *
     * Use when the release type is data, such as a CLI argument, configuration, or
     * the result of {@link difference}.
     *
     * **Details**
     *
     * Dispatches to {@link bumpMajor}, {@link bumpMinor}, {@link bumpPatch},
     * {@link bumpPremajor}, {@link bumpPreminor}, {@link bumpPrepatch}, or
     * {@link bumpPrerelease}, with the same semantics.
     *
     * **Gotchas**
     *
     * The pre-release `identifier` is ignored for `"major"`, `"minor"`, and
     * `"patch"`.
     *
     * **Example** (Bumping by a release type from input)
     *
     * ```ts import.meta.vitest
     * import { SemVer } from "effect"
     *
     * const version = SemVer.parseUnsafe("1.2.3")
     *
     * SemVer.format(SemVer.bump(version, "minor")) // => "1.3.0"
     * SemVer.format(SemVer.bump(version, "premajor", "rc")) // => "2.0.0-rc.0"
     * ```
     *
     * **Example** (Defining custom bump rules)
     *
     * ```ts import.meta.vitest
     * import { SemVer } from "effect"
     *
     * // Always increment patch, even for pre-releases, and keep build metadata
     * const customBump = (version: SemVer.SemVer, releaseType: SemVer.ReleaseType): SemVer.SemVer =>
     *   releaseType === "patch"
     *     ? SemVer.make({ ...version, patch: version.patch + 1, prerelease: [] })
     *     : SemVer.withBuild(SemVer.bump(version, releaseType), version.build)
     *
     * SemVer.format(customBump(SemVer.parseUnsafe("1.2.3-rc.1+b"), "patch")) // => "1.2.4+b"
     * SemVer.format(customBump(SemVer.parseUnsafe("1.2.3-rc.1+b"), "minor")) // => "1.3.0+b"
     * ```
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (releaseType: ReleaseType, identifier?: string): (self: SemVer) => SemVer;
    /**
     * Bumps a version by release type.
     *
     * **When to use**
     *
     * Use when the release type is data, such as a CLI argument, configuration, or
     * the result of {@link difference}.
     *
     * **Details**
     *
     * Dispatches to {@link bumpMajor}, {@link bumpMinor}, {@link bumpPatch},
     * {@link bumpPremajor}, {@link bumpPreminor}, {@link bumpPrepatch}, or
     * {@link bumpPrerelease}, with the same semantics.
     *
     * **Gotchas**
     *
     * The pre-release `identifier` is ignored for `"major"`, `"minor"`, and
     * `"patch"`.
     *
     * **Example** (Bumping by a release type from input)
     *
     * ```ts import.meta.vitest
     * import { SemVer } from "effect"
     *
     * const version = SemVer.parseUnsafe("1.2.3")
     *
     * SemVer.format(SemVer.bump(version, "minor")) // => "1.3.0"
     * SemVer.format(SemVer.bump(version, "premajor", "rc")) // => "2.0.0-rc.0"
     * ```
     *
     * **Example** (Defining custom bump rules)
     *
     * ```ts import.meta.vitest
     * import { SemVer } from "effect"
     *
     * // Always increment patch, even for pre-releases, and keep build metadata
     * const customBump = (version: SemVer.SemVer, releaseType: SemVer.ReleaseType): SemVer.SemVer =>
     *   releaseType === "patch"
     *     ? SemVer.make({ ...version, patch: version.patch + 1, prerelease: [] })
     *     : SemVer.withBuild(SemVer.bump(version, releaseType), version.build)
     *
     * SemVer.format(customBump(SemVer.parseUnsafe("1.2.3-rc.1+b"), "patch")) // => "1.2.4+b"
     * SemVer.format(customBump(SemVer.parseUnsafe("1.2.3-rc.1+b"), "minor")) // => "1.3.0+b"
     * ```
     *
     * @stability unstable
     * @category transforming
     * @since 4.0.6
     */
    (self: SemVer, releaseType: ReleaseType, identifier?: string): SemVer;
};
/**
 * Classifies the change between two versions by release type.
 *
 * **Details**
 *
 * Follows node-semver's `diff`, so the result names the bump that produces the
 * higher version from the lower one. Moving to a pre-release adds the `pre`
 * prefix, and finalizing a pre-release reports the level it was released at:
 * `1.0.0-1` to `1.0.0` is `"major"`, `1.1.0-1` to `1.1.0` is `"minor"`, and
 * `1.2.3-1` to `1.2.3` is `"patch"`. The result does not depend on argument
 * order.
 *
 * **Gotchas**
 *
 * Returns `None` for versions with the same precedence, including versions
 * that differ only in build metadata.
 *
 * **Example** (Classifying upgrades)
 *
 * ```ts import.meta.vitest
 * import { Option, SemVer } from "effect"
 *
 * SemVer.difference(SemVer.parseUnsafe("1.2.3"), SemVer.parseUnsafe("1.3.0")) // => Option.some("minor")
 * SemVer.difference(SemVer.parseUnsafe("1.2.3"), SemVer.parseUnsafe("2.0.0-rc.1")) // => Option.some("premajor")
 * SemVer.difference(SemVer.parseUnsafe("2.0.0-rc.1"), SemVer.parseUnsafe("2.0.0")) // => Option.some("major")
 * SemVer.difference(SemVer.parseUnsafe("1.2.3+a"), SemVer.parseUnsafe("1.2.3+b")) // => Option.none()
 * ```
 *
 * @see {@link bump} for applying a release type to a version
 * @stability unstable
 * @category comparisons
 * @since 4.0.6
 */
export declare const difference: {
    /**
     * Classifies the change between two versions by release type.
     *
     * **Details**
     *
     * Follows node-semver's `diff`, so the result names the bump that produces the
     * higher version from the lower one. Moving to a pre-release adds the `pre`
     * prefix, and finalizing a pre-release reports the level it was released at:
     * `1.0.0-1` to `1.0.0` is `"major"`, `1.1.0-1` to `1.1.0` is `"minor"`, and
     * `1.2.3-1` to `1.2.3` is `"patch"`. The result does not depend on argument
     * order.
     *
     * **Gotchas**
     *
     * Returns `None` for versions with the same precedence, including versions
     * that differ only in build metadata.
     *
     * **Example** (Classifying upgrades)
     *
     * ```ts import.meta.vitest
     * import { Option, SemVer } from "effect"
     *
     * SemVer.difference(SemVer.parseUnsafe("1.2.3"), SemVer.parseUnsafe("1.3.0")) // => Option.some("minor")
     * SemVer.difference(SemVer.parseUnsafe("1.2.3"), SemVer.parseUnsafe("2.0.0-rc.1")) // => Option.some("premajor")
     * SemVer.difference(SemVer.parseUnsafe("2.0.0-rc.1"), SemVer.parseUnsafe("2.0.0")) // => Option.some("major")
     * SemVer.difference(SemVer.parseUnsafe("1.2.3+a"), SemVer.parseUnsafe("1.2.3+b")) // => Option.none()
     * ```
     *
     * @see {@link bump} for applying a release type to a version
     * @stability unstable
     * @category comparisons
     * @since 4.0.6
     */
    (that: SemVer): (self: SemVer) => Option.Option<ReleaseType>;
    /**
     * Classifies the change between two versions by release type.
     *
     * **Details**
     *
     * Follows node-semver's `diff`, so the result names the bump that produces the
     * higher version from the lower one. Moving to a pre-release adds the `pre`
     * prefix, and finalizing a pre-release reports the level it was released at:
     * `1.0.0-1` to `1.0.0` is `"major"`, `1.1.0-1` to `1.1.0` is `"minor"`, and
     * `1.2.3-1` to `1.2.3` is `"patch"`. The result does not depend on argument
     * order.
     *
     * **Gotchas**
     *
     * Returns `None` for versions with the same precedence, including versions
     * that differ only in build metadata.
     *
     * **Example** (Classifying upgrades)
     *
     * ```ts import.meta.vitest
     * import { Option, SemVer } from "effect"
     *
     * SemVer.difference(SemVer.parseUnsafe("1.2.3"), SemVer.parseUnsafe("1.3.0")) // => Option.some("minor")
     * SemVer.difference(SemVer.parseUnsafe("1.2.3"), SemVer.parseUnsafe("2.0.0-rc.1")) // => Option.some("premajor")
     * SemVer.difference(SemVer.parseUnsafe("2.0.0-rc.1"), SemVer.parseUnsafe("2.0.0")) // => Option.some("major")
     * SemVer.difference(SemVer.parseUnsafe("1.2.3+a"), SemVer.parseUnsafe("1.2.3+b")) // => Option.none()
     * ```
     *
     * @see {@link bump} for applying a release type to a version
     * @stability unstable
     * @category comparisons
     * @since 4.0.6
     */
    (self: SemVer, that: SemVer): Option.Option<ReleaseType>;
};
export {};
//# sourceMappingURL=SemVer.d.ts.map