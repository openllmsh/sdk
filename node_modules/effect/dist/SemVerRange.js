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
import * as Equal from "./Equal.js";
import { dual } from "./Function.js";
import * as Hash from "./Hash.js";
import { NodeInspectSymbol } from "./Inspectable.js";
import * as Option from "./Option.js";
import { pipeArguments } from "./Pipeable.js";
import { hasProperty } from "./Predicate.js";
import * as Result from "./Result.js";
import { compareCore, fromInputUnsafe as versionFromInputUnsafe, invalid, parseComponent, prereleaseIdentifier, sameCore, tryParse } from "./SemVer.js";
const TypeId = "~effect/SemVerRange";
const SemVerRangeProto = {
  [TypeId]: TypeId,
  [Equal.symbol](that) {
    return isSemVerRange(that) && format(this) === format(that);
  },
  [Hash.symbol]() {
    return Hash.string(format(this));
  },
  toString() {
    return `SemVerRange(${format(this)})`;
  },
  toJSON() {
    return {
      _id: "SemVerRange",
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
/**
 * Checks whether a value is a `SemVerRange`.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.6
 */
export const isSemVerRange = u => hasProperty(u, TypeId);
const isRangeArgs = args => isSemVerRange(args[0]);
const wildcard = {
  components: [],
  prerelease: []
};
const operatorPattern = /^(<=|>=|<|>|=|~|\^)?(.*)$/;
const isWildcard = part => part === "x" || part === "X" || part === "*";
const componentLabels = ["major", "minor", "patch"];
const parsePartial = input => {
  if (input.length === 0) return invalid("expected a version after the operator");
  if (input.includes("+")) {
    return invalid(`build metadata is not allowed in ranges, received ${JSON.stringify(input)}`);
  }
  const dash = input.indexOf("-");
  const parts = (dash === -1 ? input : input.slice(0, dash)).split(".");
  if (parts.length > 3) return invalid(`expected at most MAJOR.MINOR.PATCH, received ${JSON.stringify(input)}`);
  const components = [];
  for (let i = 0; i < parts.length; i++) {
    if (isWildcard(parts[i])) continue;
    // A skipped wildcard leaves `components` shorter than the position reached.
    if (components.length < i) {
      return invalid(`a version component cannot follow a wildcard, received ${JSON.stringify(input)}`);
    }
    components.push(parseComponent(parts[i], componentLabels[i]));
  }
  if (dash === -1) return {
    components,
    prerelease: []
  };
  if (components.length < 3) {
    return invalid(`a pre-release requires MAJOR.MINOR.PATCH, received ${JSON.stringify(input)}`);
  }
  return {
    components,
    prerelease: input.slice(dash + 1).split(".").map(prereleaseIdentifier)
  };
};
const parseComparatorSet = input => {
  const tokens = input.split(/\s+/).filter(token => token.length > 0);
  if (tokens.length === 0) return invalid("expected a comparator");
  if (tokens.length === 3 && tokens[1] === "-") {
    return [{
      _tag: "Hyphen",
      from: parsePartial(tokens[0]),
      to: parsePartial(tokens[2])
    }];
  }
  const comparators = [];
  for (let i = 0; i < tokens.length; i++) {
    const [, operator, rest] = operatorPattern.exec(tokens[i]);
    // Allow whitespace between an operator and its version, as in `>= 1.2.3`.
    const version = rest.length === 0 && operator !== undefined && i + 1 < tokens.length ? tokens[++i] : rest;
    comparators.push({
      _tag: "Comparator",
      operator: operator ?? "=",
      version: parsePartial(version)
    });
  }
  return comparators;
};
const makeRange = sets => {
  const self = Object.create(SemVerRangeProto);
  self.sets = sets;
  return self;
};
const parseOrThrow = input => {
  if (input.trim().length === 0) return any;
  return makeRange(input.split("||").map(parseComparatorSet));
};
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
export const parse = input => tryParse("SemVer range", input, parseOrThrow);
/**
 * Parses an npm-style version range and throws `SemVer.SemVerError` for
 * invalid input.
 *
 * @see {@link parse} for non-throwing parsing
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export const parseUnsafe = input => Result.getOrThrow(parse(input));
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
export const fromInput = input => isSemVerRange(input) ? Result.succeed(input) : parse(input);
/**
 * Converts a range or range string into a `SemVerRange` and throws
 * `SemVer.SemVerError` for invalid input.
 *
 * @see {@link fromInput} for non-throwing conversion
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export const fromInputUnsafe = input => Result.getOrThrow(fromInput(input));
const toPartial = version => ({
  components: [version.major, version.minor, version.patch],
  prerelease: version.prerelease
});
const comparator = (operator, version) => ({
  _tag: "Comparator",
  operator,
  version: toPartial(versionFromInputUnsafe(version))
});
const fromComparator = (operator, version) => makeRange([[comparator(operator, version)]]);
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
export const any = /*#__PURE__*/makeRange([[{
  _tag: "Comparator",
  operator: "=",
  version: wildcard
}]]);
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
export const exact = version => fromComparator("=", version);
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
export const greaterThan = version => fromComparator(">", version);
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
export const greaterThanOrEqualTo = version => fromComparator(">=", version);
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
export const lessThan = version => fromComparator("<", version);
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
export const lessThanOrEqualTo = version => fromComparator("<=", version);
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
export const caret = version => fromComparator("^", version);
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
export const tilde = version => fromComparator("~", version);
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
export const between = options => makeRange([[comparator(">=", options.minimum), comparator("<=", options.maximum)]]);
const formatPartial = self => {
  if (self.components.length === 0) return "*";
  const core = self.components.join(".");
  return self.prerelease.length === 0 ? core : `${core}-${self.prerelease.join(".")}`;
};
const formatComparator = self => self._tag === "Hyphen" ? `${formatPartial(self.from)} - ${formatPartial(self.to)}` : `${self.operator === "=" ? "" : self.operator}${formatPartial(self.version)}`;
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
export const format = self => self.sets.map(set => set.map(formatComparator).join(" ")).join(" || ");
const bound = (operator, [major = 0, minor = 0, patch = 0], prerelease) => ({
  operator,
  major,
  minor,
  patch,
  prerelease
});
// The expansions below follow node-semver's `Range` desugaring. `z` is the
// pre-release a wildcard lower bound carries: `[0]` when pre-releases are
// included, so `>=1.2` admits `1.2.0-alpha`, and empty otherwise.
// Exclusive upper bound at the first pre-release of `core`, node-semver's `<X.Y.Z-0`.
const below = core => bound("<", core, [0]);
// The lowest version a partial covers.
const floor = (self, z) => bound(">=", self.components, self.components.length === 3 ? self.prerelease : z);
// The first core above every version the first `precision` components cover.
const after = (components, precision) => {
  const next = components.slice(0, precision);
  next[precision - 1]++;
  return next;
};
const expandCaret = (self, z) => {
  const n = self.components.length;
  if (n === 0) return [];
  // The first non-zero component may not change; `^0.0.x` pins the patch.
  const precision = self.components.findIndex(component => component !== 0) + 1 || n;
  return [floor(self, z), below(after(self.components, precision))];
};
const expandTilde = (self, z) => {
  const n = self.components.length;
  if (n === 0) return [];
  return [floor(self, z), below(after(self.components, Math.min(n, 2)))];
};
const expandXRange = (operator, self, z) => {
  const n = self.components.length;
  if (n === 3) return [bound(operator, self.components, self.prerelease)];
  if (n === 0) return operator === "<" || operator === ">" ? [below([0, 0, 0])] : [];
  switch (operator) {
    case "=":
      return [floor(self, z), below(after(self.components, n))];
    case ">":
      return [bound(">=", after(self.components, n), z)];
    case ">=":
      return [floor(self, z)];
    case "<=":
      return [below(after(self.components, n))];
    case "<":
      return [below(self.components)];
  }
};
const expand = (self, includePrerelease) => {
  const z = includePrerelease ? [0] : [];
  if (self._tag === "Hyphen") {
    const {
      from,
      to
    } = self;
    // Unlike `>=`, a full hyphen lower bound without a pre-release also takes `z`.
    const lower = from.components.length === 0 ? [] : [bound(">=", from.components, from.prerelease.length > 0 ? from.prerelease : z)];
    return [...lower, ...expandXRange("<=", to, z)];
  }
  switch (self.operator) {
    case "^":
      return expandCaret(self.version, z);
    case "~":
      return expandTilde(self.version, z);
    default:
      return expandXRange(self.operator, self.version, z);
  }
};
const testBound = (self, version) => {
  const result = compareCore(version, self);
  switch (self.operator) {
    case "=":
      return result === 0;
    case "<":
      return result < 0;
    case "<=":
      return result <= 0;
    case ">":
      return result > 0;
    case ">=":
      return result >= 0;
  }
};
const compile = (self, includePrerelease) => {
  const sets = self.sets.map(set => set.flatMap(comparator => expand(comparator, includePrerelease)));
  return version => sets.some(bounds => bounds.every(bound => testBound(bound, version)) && (includePrerelease || version.prerelease.length === 0 || bounds.some(bound => bound.prerelease.length > 0 && sameCore(bound, version))));
};
const matcher = (range, options) => {
  const self = range;
  return options?.includePrerelease === true ? self.prereleaseMatcher ??= compile(self, true) : self.matcher ??= compile(self, false);
};
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
export const matches = /*#__PURE__*/dual(isRangeArgs, (self, version, options) => matcher(self, options)(versionFromInputUnsafe(version)));
const select = (self, versions, options, better) => {
  const test = matcher(self, options);
  let selected;
  for (const input of versions) {
    const version = versionFromInputUnsafe(input);
    if (test(version) && (selected === undefined || compareCore(version, selected) === better)) {
      selected = version;
    }
  }
  return Option.fromUndefinedOr(selected);
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
export const maxSatisfying = /*#__PURE__*/dual(isRangeArgs, (self, versions, options) => select(self, versions, options, 1));
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
export const minSatisfying = /*#__PURE__*/dual(isRangeArgs, (self, versions, options) => select(self, versions, options, -1));
//# sourceMappingURL=SemVerRange.js.map