/**
 * Immutable [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)
 * values with strict parsing, canonical formatting, spec precedence ordering,
 * and version bumps.
 *
 * A `SemVer` has numeric major, minor, and patch components, optional
 * pre-release identifiers, and optional build metadata. Structural equality
 * and hashing include build metadata, while `Order` follows spec precedence
 * and ignores it. Version ranges live in `SemVerRange`.
 *
 * @stability unstable
 * @since 4.0.6
 */
import * as Data from "./Data.js";
import * as Equal from "./Equal.js";
import * as Equ from "./Equivalence.js";
import { dual } from "./Function.js";
import * as Hash from "./Hash.js";
import { NodeInspectSymbol } from "./Inspectable.js";
import * as Option from "./Option.js";
import * as order from "./Order.js";
import { pipeArguments } from "./Pipeable.js";
import { hasProperty } from "./Predicate.js";
import * as Result from "./Result.js";
const TypeId = "~effect/SemVer";
const SemVerErrorTypeId = "~effect/SemVer/SemVerError";
/**
 * Error raised for invalid version strings, ranges, or components.
 *
 * @see {@link isSemVerError} for narrowing unknown values
 * @stability unstable
 * @category errors
 * @since 4.0.6
 */
export class SemVerError extends /*#__PURE__*/Data.TaggedError("SemVerError") {
  [SemVerErrorTypeId] = SemVerErrorTypeId;
}
/**
 * Checks whether a value is a `SemVerError`.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.6
 */
export const isSemVerError = u => hasProperty(u, SemVerErrorTypeId);
/** @internal */
export const invalid = message => {
  throw new SemVerError({
    message
  });
};
const attempt = evaluate => Result.try({
  try: evaluate,
  catch: error => {
    if (!isSemVerError(error)) throw error;
    return error;
  }
});
/** @internal */
export const tryParse = (label, input, parse) => Result.mapError(attempt(() => parse(input)), error => new SemVerError({
  message: `Invalid ${label} ${JSON.stringify(input)}: ${error.message}`,
  input
}));
const numericPattern = /^(?:0|[1-9]\d*)$/;
const digitsPattern = /^\d+$/;
const identifierPattern = /^[0-9A-Za-z-]+$/;
const checkComponent = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    return invalid(`${label} must be a non-negative safe integer, received ${value}`);
  }
  return value;
};
/** @internal */
export const parseComponent = (value, label) => {
  if (!numericPattern.test(value)) {
    return invalid(`${label} must be a non-negative integer without leading zeros, received ${JSON.stringify(value)}`);
  }
  return checkComponent(Number(value), label);
};
/** @internal */
export const prereleaseIdentifier = identifier => {
  if (typeof identifier === "number") return checkComponent(identifier, "numeric pre-release identifier");
  if (!identifierPattern.test(identifier)) {
    return invalid(`pre-release identifier must be non-empty [0-9A-Za-z-], received ${JSON.stringify(identifier)}`);
  }
  return digitsPattern.test(identifier) ? parseComponent(identifier, "numeric pre-release identifier") : identifier;
};
const buildIdentifier = identifier => {
  if (!identifierPattern.test(identifier)) {
    return invalid(`build identifier must be non-empty [0-9A-Za-z-], received ${JSON.stringify(identifier)}`);
  }
  return identifier;
};
const comparePrerelease = (self, that) => {
  if (self.length === 0) return that.length === 0 ? 0 : 1;
  if (that.length === 0) return -1;
  const length = Math.min(self.length, that.length);
  for (let i = 0; i < length; i++) {
    const a = self[i];
    const b = that[i];
    if (a === b) continue;
    if (typeof a === "number") return typeof b === "number" ? order.Number(a, b) : -1;
    if (typeof b === "number") return 1;
    return order.String(a, b);
  }
  return order.Number(self.length, that.length);
};
/** @internal */
export const sameCore = (self, that) => self.major === that.major && self.minor === that.minor && self.patch === that.patch;
/** @internal */
export const compareCore = (self, that) => order.Number(self.major, that.major) || order.Number(self.minor, that.minor) || order.Number(self.patch, that.patch) || comparePrerelease(self.prerelease, that.prerelease);
const SemVerProto = {
  [TypeId]: TypeId,
  [Equal.symbol](that) {
    return isSemVer(that) && Equivalence(this, that);
  },
  [Hash.symbol]() {
    return Hash.string(format(this));
  },
  toString() {
    return `SemVer(${format(this)})`;
  },
  toJSON() {
    return {
      _id: "SemVer",
      value: format(this)
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
const unchecked = (major, minor, patch, prerelease, build) => {
  const self = Object.create(SemVerProto);
  self.major = major;
  self.minor = minor;
  self.patch = patch;
  self.prerelease = prerelease;
  self.build = build;
  return self;
};
const increment = (value, label) => {
  if (value >= Number.MAX_SAFE_INTEGER) return invalid(`${label} cannot be incremented past Number.MAX_SAFE_INTEGER`);
  return value + 1;
};
/**
 * Checks whether a value is a `SemVer`.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.6
 */
export const isSemVer = u => hasProperty(u, TypeId);
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
export const make = components => unchecked(checkComponent(components.major, "major"), checkComponent(components.minor, "minor"), checkComponent(components.patch, "patch"), components.prerelease?.map(prereleaseIdentifier) ?? [], components.build?.map(buildIdentifier) ?? []);
const parseOrThrow = input => {
  let rest = input;
  let build = [];
  const plus = rest.indexOf("+");
  if (plus !== -1) {
    build = rest.slice(plus + 1).split(".").map(buildIdentifier);
    rest = rest.slice(0, plus);
  }
  let prerelease = [];
  const dash = rest.indexOf("-");
  if (dash !== -1) {
    prerelease = rest.slice(dash + 1).split(".").map(prereleaseIdentifier);
    rest = rest.slice(0, dash);
  }
  const core = rest.split(".");
  if (core.length !== 3) return invalid("expected MAJOR.MINOR.PATCH");
  return unchecked(parseComponent(core[0], "major"), parseComponent(core[1], "minor"), parseComponent(core[2], "patch"), prerelease, build);
};
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
export const parse = input => tryParse("SemVer", input, parseOrThrow);
/**
 * Parses a strict Semantic Versioning 2.0.0 string and throws `SemVerError`
 * for invalid input.
 *
 * @see {@link parse} for non-throwing parsing
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export const parseUnsafe = input => Result.getOrThrow(parse(input));
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
export const fromInput = input => {
  if (isSemVer(input)) return Result.succeed(input);
  if (typeof input === "string") return parse(input);
  return attempt(() => make(input));
};
/**
 * Converts a version, version string, or version components into a `SemVer`
 * and throws `SemVerError` for invalid input.
 *
 * @see {@link fromInput} for non-throwing conversion
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export const fromInputUnsafe = input => Result.getOrThrow(fromInput(input));
/**
 * Formats a version as its canonical string, including pre-release identifiers
 * and build metadata.
 *
 * @see {@link parse} for the inverse operation
 * @stability unstable
 * @category converting
 * @since 4.0.6
 */
export const format = self => {
  let out = `${self.major}.${self.minor}.${self.patch}`;
  if (self.prerelease.length > 0) out += `-${self.prerelease.join(".")}`;
  if (self.build.length > 0) out += `+${self.build.join(".")}`;
  return out;
};
/**
 * Checks whether a version has pre-release identifiers.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export const isPrerelease = self => self.prerelease.length > 0;
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
export const hasBuild = self => self.build.length > 0;
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
export const isInitialDevelopment = self => self.major === 0;
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
export const Order = /*#__PURE__*/order.make(compareCore);
const identifiersEqual = /*#__PURE__*/Equ.Array(/*#__PURE__*/Equ.strictEqual());
/**
 * Provides structural equivalence for versions, including build metadata.
 *
 * @see {@link Order} for precedence that ignores build metadata
 * @stability unstable
 * @category instances
 * @since 4.0.6
 */
export const Equivalence = /*#__PURE__*/Equ.make((self, that) => self.major === that.major && self.minor === that.minor && self.patch === that.patch && identifiersEqual(self.prerelease, that.prerelease) && identifiersEqual(self.build, that.build));
/**
 * Checks whether two versions are structurally equal, including build
 * metadata.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export const equals = /*#__PURE__*/dual(2, Equivalence);
/**
 * Checks whether the first version has lower precedence than the second.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export const isLessThan = /*#__PURE__*/order.isLessThan(Order);
/**
 * Checks whether the first version has lower or equal precedence than the
 * second.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export const isLessThanOrEqualTo = /*#__PURE__*/order.isLessThanOrEqualTo(Order);
/**
 * Checks whether the first version has higher precedence than the second.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export const isGreaterThan = /*#__PURE__*/order.isGreaterThan(Order);
/**
 * Checks whether the first version has higher or equal precedence than the
 * second.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export const isGreaterThanOrEqualTo = /*#__PURE__*/order.isGreaterThanOrEqualTo(Order);
/**
 * Checks whether a version's precedence is within an inclusive range.
 *
 * @stability unstable
 * @category predicates
 * @since 4.0.6
 */
export const between = /*#__PURE__*/order.isBetween(Order);
/**
 * Returns the version with lower precedence, preferring the first on ties.
 *
 * @stability unstable
 * @category ordering
 * @since 4.0.6
 */
export const min = /*#__PURE__*/order.min(Order);
/**
 * Returns the version with higher precedence, preferring the first on ties.
 *
 * @stability unstable
 * @category ordering
 * @since 4.0.6
 */
export const max = /*#__PURE__*/order.max(Order);
/**
 * Constrains a version's precedence to an inclusive range.
 *
 * @stability unstable
 * @category ordering
 * @since 4.0.6
 */
export const clamp = /*#__PURE__*/order.clamp(Order);
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
export const withPrerelease = /*#__PURE__*/dual(2, (self, prerelease) => unchecked(self.major, self.minor, self.patch, prerelease.map(prereleaseIdentifier), self.build));
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
export const withBuild = /*#__PURE__*/dual(2, (self, build) => unchecked(self.major, self.minor, self.patch, self.prerelease, build.map(buildIdentifier)));
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
export const release = self => self.prerelease.length === 0 && self.build.length === 0 ? self : unchecked(self.major, self.minor, self.patch, [], []);
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
export const bumpMajor = self => unchecked(self.minor === 0 && self.patch === 0 && self.prerelease.length > 0 ? self.major : increment(self.major, "major"), 0, 0, [], []);
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
export const bumpMinor = self => unchecked(self.major, self.patch === 0 && self.prerelease.length > 0 ? self.minor : increment(self.minor, "minor"), 0, [], []);
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
export const bumpPatch = self => unchecked(self.major, self.minor, self.prerelease.length > 0 ? self.patch : increment(self.patch, "patch"), [], []);
const startPrerelease = identifier => identifier === undefined ? [0] : [prereleaseIdentifier(identifier), 0];
const isSemVerArgs = args => isSemVer(args[0]);
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
export const bumpPremajor = /*#__PURE__*/dual(isSemVerArgs, (self, identifier) => unchecked(increment(self.major, "major"), 0, 0, startPrerelease(identifier), []));
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
export const bumpPreminor = /*#__PURE__*/dual(isSemVerArgs, (self, identifier) => unchecked(self.major, increment(self.minor, "minor"), 0, startPrerelease(identifier), []));
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
export const bumpPrepatch = /*#__PURE__*/dual(isSemVerArgs, (self, identifier) => unchecked(self.major, self.minor, increment(self.patch, "patch"), startPrerelease(identifier), []));
const nextPrerelease = prerelease => {
  for (let i = prerelease.length - 1; i >= 0; i--) {
    const identifier = prerelease[i];
    if (typeof identifier === "number") {
      const next = prerelease.slice();
      next[i] = increment(identifier, "pre-release identifier");
      return next;
    }
  }
  return [...prerelease, 0];
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
export const bumpPrerelease = /*#__PURE__*/dual(isSemVerArgs, (self, identifier) => {
  if (self.prerelease.length === 0) {
    return unchecked(self.major, self.minor, increment(self.patch, "patch"), startPrerelease(identifier), []);
  }
  if (identifier !== undefined) {
    const normalized = prereleaseIdentifier(identifier);
    if (self.prerelease[0] !== normalized) {
      return unchecked(self.major, self.minor, self.patch, [normalized, 0], []);
    }
  }
  return unchecked(self.major, self.minor, self.patch, nextPrerelease(self.prerelease), []);
});
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
export const bump = /*#__PURE__*/dual(isSemVerArgs, (self, releaseType, identifier) => {
  switch (releaseType) {
    case "major":
      return bumpMajor(self);
    case "minor":
      return bumpMinor(self);
    case "patch":
      return bumpPatch(self);
    case "premajor":
      return bumpPremajor(self, identifier);
    case "preminor":
      return bumpPreminor(self, identifier);
    case "prepatch":
      return bumpPrepatch(self, identifier);
    case "prerelease":
      return bumpPrerelease(self, identifier);
  }
});
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
export const difference = /*#__PURE__*/dual(2, (self, that) => {
  const comparison = Order(self, that);
  if (comparison === 0) return Option.none();
  const [low, high] = comparison < 0 ? [self, that] : [that, self];
  const highIsPrerelease = high.prerelease.length > 0;
  if (low.prerelease.length > 0 && !highIsPrerelease) {
    if (low.minor === 0 && low.patch === 0) return Option.some("major");
    if (sameCore(low, high)) return Option.some(low.patch === 0 ? "minor" : "patch");
  }
  if (self.major !== that.major) return Option.some(highIsPrerelease ? "premajor" : "major");
  if (self.minor !== that.minor) return Option.some(highIsPrerelease ? "preminor" : "minor");
  if (self.patch !== that.patch) return Option.some(highIsPrerelease ? "prepatch" : "patch");
  return Option.some("prerelease");
});
//# sourceMappingURL=SemVer.js.map