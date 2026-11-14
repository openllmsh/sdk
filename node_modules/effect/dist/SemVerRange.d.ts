/**
 * npm-style version ranges over `SemVer` values.
 *
 * A `SemVerRange` keeps the syntax it was parsed from, such as `^1.2`, `~1.2.3`,
 * `1.x`, or `1.2.3 - 2.3.4`. Matching follows node-semver's pre-release rules,
 * except that wildcard alternatives preserve the union described in {@link matches}.
 *
 * @stability unstable
 * @since 4.0.6
 */
import * as Equal from "./Equal.ts";
import { type Inspectable } from "./Inspectable.ts";
import * as Option from "./Option.ts";
import { type Pipeable } from "./Pipeable.ts";
import * as Result from "./Result.ts";
import { type Input as VersionInput, type SemVer, type SemVerError } from "./SemVer.ts";
declare const TypeId = "~effect/SemVerRange";
/**
 * Represents an npm-style version range.
 *
 * **Details**
 *
 * Ranges are opaque. {@link format} preserves parsed operators such as `^1.2`
 * rather than expanding them into bounds.
 *
 * @see {@link parse} for decoding range strings
 * @see {@link matches} for matching versions
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface SemVerRange extends Pipeable, Equal.Equal, Inspectable {
    readonly [TypeId]: typeof TypeId;
}
/**
 * Options controlling how pre-release versions match a range.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface MatchOptions {
    /**
     * Lets pre-release versions match any comparator set whose bounds contain
     * them, and lowers wildcard lower bounds to include pre-releases.
     *
     * @default false
     */
    readonly includePrerelease?: boolean | undefined;
}
/**
 * Checks whether a value is a `SemVerRange`.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.6
 */
export declare const isSemVerRange: (u: unknown) => u is SemVerRange;
/**
 * Parses an npm-style version range.
 *
 * **Details**
 *
 * Supports:
 *
 * - comparators `=`, `<`, `<=`, `>`, `>=`, whitespace-separated as AND;
 * - alternatives separated by `||`;
 * - X-ranges such as `1.x`, `1.2.*`, `1`, and `*`;
 * - tilde (`~1.2.3`), caret (`^1.2.3`), and hyphen (`1.2.3 - 2.3.4`) ranges.
 *
 * An empty string is equivalent to `*`. Invalid input fails with
 * `SemVer.SemVerError`.
 *
 * **Gotchas**
 *
 * Versions must follow the strict SemVer grammar apart from wildcards, so a
 * `v` prefix, leading zeros, build metadata, and empty `||` alternatives are
 * rejected.
 *
 * **Example** (Parsing and matching a caret range)
 *
 * ```ts import.meta.vitest
 * import { Result, SemVerRange } from "effect"
 *
 * const range = SemVerRange.parseUnsafe("^1.2.0 || >=3.0.0-rc.1")
 *
 * SemVerRange.matches(range, "1.9.0") // => true
 * SemVerRange.matches(range, "2.0.0") // => false
 * SemVerRange.matches(range, "3.0.0-rc.2") // => true
 * Result.isFailure(SemVerRange.parse("^v1.2.0")) // => true
 * ```
 *
 * @see {@link parseUnsafe} for throwing on invalid input
 * @see {@link format} for the inverse operation
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const parse: (input: string) => Result.Result<SemVerRange, SemVerError>;
/**
 * Parses an npm-style version range and throws `SemVer.SemVerError` for
 * invalid input.
 *
 * @see {@link parse} for non-throwing parsing
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const parseUnsafe: (input: string) => SemVerRange;
/**
 * Values accepted by `fromInput`: a range or a range string.
 *
 * @see {@link fromInput} for converting inputs
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type Input = SemVerRange | string;
/**
 * Converts a range or range string into a `SemVerRange`.
 *
 * **Details**
 *
 * Ranges are returned unchanged and strings are parsed like {@link parse}.
 * Invalid strings fail with `SemVer.SemVerError`.
 *
 * @see {@link fromInputUnsafe} for throwing on invalid input
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const fromInput: (input: Input) => Result.Result<SemVerRange, SemVerError>;
/**
 * Converts a range or range string into a `SemVerRange` and throws
 * `SemVer.SemVerError` for invalid input.
 *
 * @see {@link fromInput} for non-throwing conversion
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const fromInputUnsafe: (input: Input) => SemVerRange;
/**
 * The range matching every release, written `*`.
 *
 * **Gotchas**
 *
 * Like every range, `*` only matches pre-releases with `includePrerelease`.
 *
 * @stability unstable
 * @category constants
 * @since 4.0.6
 */
export declare const any: SemVerRange;
/**
 * Creates a range matching exactly one version, written `1.2.3`.
 *
 * **Details**
 *
 * Build metadata is dropped because ranges cannot express it and it does not
 * affect matching, so `1.2.3+a` and `1.2.3+b` both match. Throws `SemVerError` for an invalid `SemVer.Input`.
 *
 * **Example** (Building ranges from versions)
 *
 * ```ts import.meta.vitest
 * import { SemVer, SemVerRange } from "effect"
 *
 * const version = SemVer.parseUnsafe("1.2.3+build.5")
 *
 * SemVerRange.format(SemVerRange.exact(version)) // => "1.2.3"
 * SemVerRange.format(SemVerRange.greaterThanOrEqualTo(version)) // => ">=1.2.3"
 * SemVerRange.format(SemVerRange.caret("1.2.3")) // => "^1.2.3"
 * SemVerRange.matches(SemVerRange.greaterThan(version), "1.2.4") // => true
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const exact: (version: VersionInput) => SemVerRange;
/**
 * Creates a range matching versions with higher precedence, written `>1.2.3`.
 *
 * **Details**
 *
 * Build metadata is dropped. Throws `SemVerError` for an invalid `SemVer.Input`.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const greaterThan: (version: VersionInput) => SemVerRange;
/**
 * Creates a range matching versions with at least the given precedence, written `>=1.2.3`.
 *
 * **Details**
 *
 * Build metadata is dropped. Throws `SemVerError` for an invalid `SemVer.Input`.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const greaterThanOrEqualTo: (version: VersionInput) => SemVerRange;
/**
 * Creates a range matching versions with lower precedence, written `<1.2.3`.
 *
 * **Details**
 *
 * Build metadata is dropped. Throws `SemVerError` for an invalid `SemVer.Input`.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const lessThan: (version: VersionInput) => SemVerRange;
/**
 * Creates a range matching versions with at most the given precedence, written `<=1.2.3`.
 *
 * **Details**
 *
 * Build metadata is dropped. Throws `SemVerError` for an invalid `SemVer.Input`.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const lessThanOrEqualTo: (version: VersionInput) => SemVerRange;
/**
 * Creates a range matching versions compatible with a version, written `^1.2.3`.
 *
 * **Details**
 *
 * Allows changes that do not modify the left-most non-zero component: `^1.2.3`
 * means `>=1.2.3 <2.0.0-0` and `^0.2.3` means `>=0.2.3 <0.3.0-0`. Build
 * metadata is dropped. Throws `SemVerError` for an invalid `SemVer.Input`.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const caret: (version: VersionInput) => SemVerRange;
/**
 * Creates a range matching patch-level changes of a version, written `~1.2.3`.
 *
 * **Details**
 *
 * `~1.2.3` means `>=1.2.3 <1.3.0-0`. Build metadata is dropped.
 * Throws `SemVerError` for an invalid `SemVer.Input`.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const tilde: (version: VersionInput) => SemVerRange;
/**
 * Creates a range matching versions within inclusive bounds, written
 * `>=1.2.3 <=2.0.0`.
 *
 * **Details**
 *
 * Matches the same versions as `SemVer.between`, subject to the pre-release
 * rule. Build metadata is dropped. Throws `SemVerError` for an invalid `SemVer.Input`.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export declare const between: (options: {
    readonly minimum: VersionInput;
    readonly maximum: VersionInput;
}) => SemVerRange;
/**
 * Formats a range in canonical form.
 *
 * **Details**
 *
 * Operators and comparators are kept as parsed. Wildcard spellings are
 * normalized by dropping trailing wildcard components (`1.x` and `1.*.*`
 * format as `1`, and `x` as `*`), and an explicit `=` operator is omitted.
 *
 * @see {@link parse} for the inverse operation
 * @stability unstable
 * @category converting
 * @since 4.0.6
 */
export declare const format: (self: SemVerRange) => string;
/**
 * Checks whether a range matches a version.
 *
 * **Details**
 *
 * Partial versions, tilde, caret, and hyphen ranges expand to bounds following
 * node-semver. For example, `^1.2.3` means `>=1.2.3 <2.0.0-0`, `~1.2` means
 * `>=1.2.0 <1.3.0-0`, and `<=1.2` means `<1.3.0-0`. Throws `SemVerError` when
 * `version` is an invalid `SemVer.Input`.
 *
 * **Gotchas**
 *
 * A pre-release version only matches a comparator set that contains a
 * comparator with a pre-release on the same major, minor, and patch. So
 * `^1.2.3-beta.1` matches `1.2.3-beta.2` but not `1.3.0-rc.1`, and `*` does
 * not match any pre-release. Set `includePrerelease` to disable this rule.
 *
 * Alternatives separated by `||` always form a union. Unlike node-semver, a `*`
 * alternative does not discard pre-releases admitted by another alternative.
 *
 * **Example** (Matching pre-releases)
 *
 * ```ts import.meta.vitest
 * import { SemVerRange } from "effect"
 *
 * const range = SemVerRange.parseUnsafe("^1.2.3-beta.1")
 *
 * SemVerRange.matches(range, "1.2.3-beta.2") // => true
 * SemVerRange.matches(range, "1.3.0-rc.1") // => false
 * SemVerRange.matches(range, "1.3.0-rc.1", { includePrerelease: true }) // => true
 * ```
 *
 * **Example** (Filtering versions)
 *
 * ```ts import.meta.vitest
 * import { SemVer, SemVerRange } from "effect"
 *
 * const range = SemVerRange.parseUnsafe("~1.2")
 * const versions = ["1.1.0", "1.2.0", "1.2.7", "1.3.0"].map(SemVer.parseUnsafe)
 *
 * versions.filter((version) => SemVerRange.matches(range, version)).map(SemVer.format) // => ["1.2.0", "1.2.7"]
 * ```
 *
 * @see {@link maxSatisfying} for selecting the highest matching version
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export declare const matches: {
    /**
     * Checks whether a range matches a version.
     *
     * **Details**
     *
     * Partial versions, tilde, caret, and hyphen ranges expand to bounds following
     * node-semver. For example, `^1.2.3` means `>=1.2.3 <2.0.0-0`, `~1.2` means
     * `>=1.2.0 <1.3.0-0`, and `<=1.2` means `<1.3.0-0`. Throws `SemVerError` when
     * `version` is an invalid `SemVer.Input`.
     *
     * **Gotchas**
     *
     * A pre-release version only matches a comparator set that contains a
     * comparator with a pre-release on the same major, minor, and patch. So
     * `^1.2.3-beta.1` matches `1.2.3-beta.2` but not `1.3.0-rc.1`, and `*` does
     * not match any pre-release. Set `includePrerelease` to disable this rule.
     *
     * Alternatives separated by `||` always form a union. Unlike node-semver, a `*`
     * alternative does not discard pre-releases admitted by another alternative.
     *
     * **Example** (Matching pre-releases)
     *
     * ```ts import.meta.vitest
     * import { SemVerRange } from "effect"
     *
     * const range = SemVerRange.parseUnsafe("^1.2.3-beta.1")
     *
     * SemVerRange.matches(range, "1.2.3-beta.2") // => true
     * SemVerRange.matches(range, "1.3.0-rc.1") // => false
     * SemVerRange.matches(range, "1.3.0-rc.1", { includePrerelease: true }) // => true
     * ```
     *
     * **Example** (Filtering versions)
     *
     * ```ts import.meta.vitest
     * import { SemVer, SemVerRange } from "effect"
     *
     * const range = SemVerRange.parseUnsafe("~1.2")
     * const versions = ["1.1.0", "1.2.0", "1.2.7", "1.3.0"].map(SemVer.parseUnsafe)
     *
     * versions.filter((version) => SemVerRange.matches(range, version)).map(SemVer.format) // => ["1.2.0", "1.2.7"]
     * ```
     *
     * @see {@link maxSatisfying} for selecting the highest matching version
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (version: VersionInput, options?: MatchOptions): (self: SemVerRange) => boolean;
    /**
     * Checks whether a range matches a version.
     *
     * **Details**
     *
     * Partial versions, tilde, caret, and hyphen ranges expand to bounds following
     * node-semver. For example, `^1.2.3` means `>=1.2.3 <2.0.0-0`, `~1.2` means
     * `>=1.2.0 <1.3.0-0`, and `<=1.2` means `<1.3.0-0`. Throws `SemVerError` when
     * `version` is an invalid `SemVer.Input`.
     *
     * **Gotchas**
     *
     * A pre-release version only matches a comparator set that contains a
     * comparator with a pre-release on the same major, minor, and patch. So
     * `^1.2.3-beta.1` matches `1.2.3-beta.2` but not `1.3.0-rc.1`, and `*` does
     * not match any pre-release. Set `includePrerelease` to disable this rule.
     *
     * Alternatives separated by `||` always form a union. Unlike node-semver, a `*`
     * alternative does not discard pre-releases admitted by another alternative.
     *
     * **Example** (Matching pre-releases)
     *
     * ```ts import.meta.vitest
     * import { SemVerRange } from "effect"
     *
     * const range = SemVerRange.parseUnsafe("^1.2.3-beta.1")
     *
     * SemVerRange.matches(range, "1.2.3-beta.2") // => true
     * SemVerRange.matches(range, "1.3.0-rc.1") // => false
     * SemVerRange.matches(range, "1.3.0-rc.1", { includePrerelease: true }) // => true
     * ```
     *
     * **Example** (Filtering versions)
     *
     * ```ts import.meta.vitest
     * import { SemVer, SemVerRange } from "effect"
     *
     * const range = SemVerRange.parseUnsafe("~1.2")
     * const versions = ["1.1.0", "1.2.0", "1.2.7", "1.3.0"].map(SemVer.parseUnsafe)
     *
     * versions.filter((version) => SemVerRange.matches(range, version)).map(SemVer.format) // => ["1.2.0", "1.2.7"]
     * ```
     *
     * @see {@link maxSatisfying} for selecting the highest matching version
     * @stability unstable
     * @category predicates
     * @since 4.0.6
     */
    (self: SemVerRange, version: VersionInput, options?: MatchOptions): boolean;
};
/**
 * Returns the version with the highest precedence that a range matches.
 *
 * **Details**
 *
 * Returns `None` when no version matches. When several versions share the
 * highest precedence, the first one is returned. Throws `SemVerError` when a
 * version is an invalid `SemVer.Input`.
 *
 * **Example** (Selecting the newest compatible version)
 *
 * ```ts import.meta.vitest
 * import { Option, SemVer, SemVerRange } from "effect"
 *
 * const range = SemVerRange.parseUnsafe("^1.2.0")
 *
 * SemVerRange.maxSatisfying(range, ["1.2.0", "1.4.1", "2.0.0", "1.5.0-rc.1"]).pipe(Option.map(SemVer.format)) // => Option.some("1.4.1")
 * ```
 *
 * @see {@link minSatisfying} for the lowest matching version
 * @stability unstable
 * @category filtering
 * @since 4.0.6
 */
export declare const maxSatisfying: {
    /**
     * Returns the version with the highest precedence that a range matches.
     *
     * **Details**
     *
     * Returns `None` when no version matches. When several versions share the
     * highest precedence, the first one is returned. Throws `SemVerError` when a
     * version is an invalid `SemVer.Input`.
     *
     * **Example** (Selecting the newest compatible version)
     *
     * ```ts import.meta.vitest
     * import { Option, SemVer, SemVerRange } from "effect"
     *
     * const range = SemVerRange.parseUnsafe("^1.2.0")
     *
     * SemVerRange.maxSatisfying(range, ["1.2.0", "1.4.1", "2.0.0", "1.5.0-rc.1"]).pipe(Option.map(SemVer.format)) // => Option.some("1.4.1")
     * ```
     *
     * @see {@link minSatisfying} for the lowest matching version
     * @stability unstable
     * @category filtering
     * @since 4.0.6
     */
    (versions: Iterable<VersionInput>, options?: MatchOptions): (self: SemVerRange) => Option.Option<SemVer>;
    /**
     * Returns the version with the highest precedence that a range matches.
     *
     * **Details**
     *
     * Returns `None` when no version matches. When several versions share the
     * highest precedence, the first one is returned. Throws `SemVerError` when a
     * version is an invalid `SemVer.Input`.
     *
     * **Example** (Selecting the newest compatible version)
     *
     * ```ts import.meta.vitest
     * import { Option, SemVer, SemVerRange } from "effect"
     *
     * const range = SemVerRange.parseUnsafe("^1.2.0")
     *
     * SemVerRange.maxSatisfying(range, ["1.2.0", "1.4.1", "2.0.0", "1.5.0-rc.1"]).pipe(Option.map(SemVer.format)) // => Option.some("1.4.1")
     * ```
     *
     * @see {@link minSatisfying} for the lowest matching version
     * @stability unstable
     * @category filtering
     * @since 4.0.6
     */
    (self: SemVerRange, versions: Iterable<VersionInput>, options?: MatchOptions): Option.Option<SemVer>;
};
/**
 * Returns the version with the lowest precedence that a range matches.
 *
 * **Details**
 *
 * Returns `None` when no version matches. When several versions share the
 * lowest precedence, the first one is returned. Throws `SemVerError` when a
 * version is an invalid `SemVer.Input`.
 *
 * @see {@link maxSatisfying} for the highest matching version
 * @stability unstable
 * @category filtering
 * @since 4.0.6
 */
export declare const minSatisfying: {
    /**
     * Returns the version with the lowest precedence that a range matches.
     *
     * **Details**
     *
     * Returns `None` when no version matches. When several versions share the
     * lowest precedence, the first one is returned. Throws `SemVerError` when a
     * version is an invalid `SemVer.Input`.
     *
     * @see {@link maxSatisfying} for the highest matching version
     * @stability unstable
     * @category filtering
     * @since 4.0.6
     */
    (versions: Iterable<VersionInput>, options?: MatchOptions): (self: SemVerRange) => Option.Option<SemVer>;
    /**
     * Returns the version with the lowest precedence that a range matches.
     *
     * **Details**
     *
     * Returns `None` when no version matches. When several versions share the
     * lowest precedence, the first one is returned. Throws `SemVerError` when a
     * version is an invalid `SemVer.Input`.
     *
     * @see {@link maxSatisfying} for the highest matching version
     * @stability unstable
     * @category filtering
     * @since 4.0.6
     */
    (self: SemVerRange, versions: Iterable<VersionInput>, options?: MatchOptions): Option.Option<SemVer>;
};
export {};
//# sourceMappingURL=SemVerRange.d.ts.map