/**
 * Models HTTP headers for the unstable HTTP client and server modules.
 *
 * `Headers` values are immutable maps keyed by lowercase header name. This
 * module converts common header inputs into that shape, provides helpers for
 * reading and updating header values, and redacts configured sensitive headers
 * when values are inspected.
 *
 * It also parses and formats the values of standard headers, such as HTTP
 * dates and `Retry-After`, with the tolerance the RFCs allow and nothing more.
 * The string codecs for those values live in `Schema`, for example
 * `Schema.DateTimeUtcFromHttpDate` and `Schema.RetryAfterFromString`.
 *
 * @stability unstable
 * @since 4.0.0
 */
import * as Context from "../Context.js";
import * as Data from "../Data.js";
import * as DateTime from "../DateTime.js";
import * as Duration from "../Duration.js";
import * as Equal from "../Equal.js";
import * as Equ from "../Equivalence.js";
import { dual } from "../Function.js";
import * as Hash from "../Hash.js";
import * as Inspectable from "../Inspectable.js";
import * as Option from "../Option.js";
import * as Predicate from "../Predicate.js";
import * as Record from "../Record.js";
import * as Redactable from "../Redactable.js";
import * as Redacted from "../Redacted.js";
import * as Result from "../Result.js";
/**
 * Runtime type identifier for `Headers` values.
 *
 * @stability unstable
 * @category type IDs
 * @since 4.0.0
 */
export const TypeId = /*#__PURE__*/Symbol.for("~effect/http/Headers");
/**
 * Returns `true` if the provided value is a `Headers` value.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export const isHeaders = u => Predicate.hasProperty(u, TypeId);
// the properties are folded into the initializer (rather than a separate
// `Object.defineProperties(Proto, ...)` statement) so the whole definition
// is pure-annotated by the build and tree-shakable.
const Proto = /*#__PURE__*/Object.defineProperties(/*#__PURE__*/Object.create(null), {
  [TypeId]: {
    value: TypeId
  },
  [Redactable.symbolRedactable]: {
    value(context) {
      return redact(this, Context.get(context, CurrentRedactedNames));
    }
  },
  toJSON: {
    value() {
      return Redactable.redact(this);
    }
  },
  [Equal.symbol]: {
    value(that) {
      return Equivalence(this, that);
    }
  },
  [Hash.symbol]: {
    value() {
      return Hash.structure(this);
    }
  },
  toString: {
    value: Inspectable.BaseProto.toString
  },
  [Inspectable.NodeInspectSymbol]: {
    value: Inspectable.BaseProto[Inspectable.NodeInspectSymbol]
  }
});
const make = input => Object.assign(Object.create(Proto), input);
/**
 * Provides an `Equivalence` instance that compares `Headers` by header names
 * and string values.
 *
 * @stability unstable
 * @category instances
 * @since 4.0.0
 */
export const Equivalence = /*#__PURE__*/Record.makeEquivalence(/*#__PURE__*/Equ.strictEqual());
/**
 * An empty `Headers` collection.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export const empty = /*#__PURE__*/Object.create(Proto);
/**
 * Creates `Headers` from a record or iterable of header entries.
 *
 * **Details**
 *
 * Header names are normalized to lowercase. Array values in record input are joined with `", "`, and `undefined` values are omitted.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export const fromInput = input => {
  if (input === undefined) {
    return empty;
  } else if (Symbol.iterator in input) {
    const out = Object.create(Proto);
    for (const [k, v] of input) {
      out[k.toLowerCase()] = v;
    }
    return out;
  }
  const out = Object.create(Proto);
  for (const [k, v] of Object.entries(input)) {
    if (Array.isArray(v)) {
      out[k.toLowerCase()] = v.join(", ");
    } else if (v !== undefined) {
      out[k.toLowerCase()] = v;
    }
  }
  return out;
};
/**
 * Treats an existing record as `Headers` unsafely.
 *
 * **Gotchas**
 *
 * This mutates the record's prototype and does not normalize header names; callers must provide the expected lowercase keys.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export const fromRecordUnsafe = input => Object.setPrototypeOf(input, Proto);
/**
 * Returns `true` when a header with the given name is present.
 *
 * **Details**
 *
 * The lookup lowercases the provided header name.
 *
 * @stability unstable
 * @category combinators
 * @since 4.0.0
 */
export const has = /*#__PURE__*/dual(2, (self, key) => key.toLowerCase() in self);
/**
 * Gets a header value by name safely.
 *
 * **Details**
 *
 * The lookup lowercases the provided header name and returns `Option.none()` when absent.
 *
 * @stability unstable
 * @category combinators
 * @since 4.0.0
 */
export const get = /*#__PURE__*/dual(2, (self, key) => Option.fromUndefinedOr(self[key.toLowerCase()]));
/**
 * Returns a new `Headers` collection with the given header set.
 *
 * **Details**
 *
 * The header name is normalized to lowercase.
 *
 * @stability unstable
 * @category combinators
 * @since 4.0.0
 */
export const set = /*#__PURE__*/dual(3, (self, key, value) => {
  const out = make(self);
  out[key.toLowerCase()] = value;
  return out;
});
/**
 * Returns a new `Headers` collection with all provided headers set.
 *
 * **Details**
 *
 * Input headers are normalized with `fromInput` and override existing headers with the same lowercase name.
 *
 * @stability unstable
 * @category combinators
 * @since 4.0.0
 */
export const setAll = /*#__PURE__*/dual(2, (self, headers) => make({
  ...self,
  ...fromInput(headers)
}));
/**
 * Returns a new `Headers` collection containing headers from both collections.
 *
 * **Details**
 *
 * Headers from the second collection override headers from the first collection with the same name.
 *
 * @stability unstable
 * @category combinators
 * @since 4.0.0
 */
export const merge = /*#__PURE__*/dual(2, (self, headers) => {
  const out = make(self);
  Object.assign(out, headers);
  return out;
});
/**
 * Returns a new `Headers` collection with the named header removed.
 *
 * **Details**
 *
 * The provided header name is normalized to lowercase before removal.
 *
 * @stability unstable
 * @category combinators
 * @since 4.0.0
 */
export const remove = /*#__PURE__*/dual(2, (self, key) => {
  const out = make(self);
  delete out[key.toLowerCase()];
  return out;
});
/**
 * Returns a new `Headers` collection with each named header removed.
 *
 * **Details**
 *
 * Each provided header name is normalized to lowercase before removal.
 *
 * @stability unstable
 * @category combinators
 * @since 4.0.0
 */
export const removeMany = /*#__PURE__*/dual(2, (self, keys) => {
  const out = make(self);
  for (const key of keys) {
    delete out[key.toLowerCase()];
  }
  return out;
});
/**
 * Returns a plain record with selected header values wrapped in `Redacted`.
 *
 * **Details**
 *
 * String keys are normalized to lowercase before matching; regular expressions are tested against the stored header names.
 *
 * @stability unstable
 * @category combinators
 * @since 4.0.0
 */
export const redact = /*#__PURE__*/dual(2, (self, key) => {
  const out = {
    ...self
  };
  const modify = key => {
    if (typeof key === "string") {
      const k = key.toLowerCase();
      if (k in self) {
        out[k] = Redacted.make(self[k]);
      }
    } else {
      for (const name in self) {
        if (name.search(key) !== -1) {
          out[name] = Redacted.make(self[name]);
        }
      }
    }
  };
  if (Array.isArray(key)) {
    for (let i = 0; i < key.length; i++) {
      modify(key[i]);
    }
  } else {
    modify(key);
  }
  return out;
});
/**
 * Checks whether a header name matches one of the redaction patterns.
 *
 * **Details**
 *
 * String patterns are compared case-insensitively against the header name;
 * regular expressions are tested against it. Use to avoid the record copy of
 * `redact` when only a membership check is needed.
 *
 * @stability unstable
 * @category combinators
 * @since 4.0.0
 */
export const isRedactedName = (name, patterns) => {
  const lowerName = name.toLowerCase();
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    if (typeof pattern === "string") {
      if (pattern.toLowerCase() === lowerName) {
        return true;
      }
    } else if (name.search(pattern) !== -1) {
      return true;
    }
  }
  return false;
};
/**
 * Context reference listing header names or patterns that should be redacted when `Headers` are inspected or rendered.
 *
 * **Details**
 *
 * Defaults include `authorization`, `cookie`, `set-cookie` and `x-api-key`.
 * A custom list replaces the defaults. Matching uses `isRedactedName`.
 * Use `UrlParams.CurrentRedactedNames` for query parameters.
 *
 * @stability unstable
 * @category services
 * @since 4.0.0
 */
export const CurrentRedactedNames = /*#__PURE__*/Context.Reference("effect/Headers/CurrentRedactedNames", {
  defaultValue: () => ["authorization", "cookie", "set-cookie", "x-api-key"]
});
// -----------------------------------------------------------------------------
// Header values
// -----------------------------------------------------------------------------
const HeaderParseErrorTypeId = "~effect/http/Headers/HeaderParseError";
/**
 * Error reason describing which header value failed to parse.
 *
 * **Details**
 *
 * `input` is the raw header value that was rejected.
 *
 * @stability unstable
 * @category errors
 * @since 4.0.0
 */
export class HeaderParseErrorReason extends Data.Error {}
/**
 * Error returned when a header value does not match its grammar.
 *
 * **Details**
 *
 * Inspect `reason` to find the header that failed and the rejected input.
 *
 * @stability unstable
 * @category errors
 * @since 4.0.0
 */
export class HeaderParseError extends /*#__PURE__*/Data.TaggedError("HeaderParseError") {
  /**
   * Creates a header parse error from a reason tag and the rejected input.
   *
   * @stability unstable
   * @since 4.0.0
   */
  static fromReason(reason, input) {
    return new HeaderParseError({
      reason: new HeaderParseErrorReason({
        _tag: reason,
        input
      })
    });
  }
  /**
   * Marks this value as a header parse error for runtime guards.
   *
   * @stability unstable
   * @since 4.0.0
   */
  [HeaderParseErrorTypeId] = HeaderParseErrorTypeId;
  /**
   * Names the failed header and the rejected input.
   *
   * @stability unstable
   * @since 4.0.0
   */
  get message() {
    return `${this.reason._tag}: ${JSON.stringify(this.reason.input)}`;
  }
}
/**
 * Checks whether a value is a `HeaderParseError`.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export const isHeaderParseError = u => Predicate.hasProperty(u, HeaderParseErrorTypeId);
// -----------------------------------------------------------------------------
// HTTP dates (RFC 9110 §5.6.7)
// -----------------------------------------------------------------------------
const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// RFC 9110 §5.6.7: IMF-fixdate, then the obsolete RFC 850 and asctime forms
const httpDateFormats = [
// Sun, 06 Nov 1994 08:49:37 GMT
/^(?:mon|tue|wed|thu|fri|sat|sun), (?<day>\d{2}) (?<month>[a-z]{3}) (?<year>\d{4}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) gmt$/i,
// Sunday, 06-Nov-94 08:49:37 GMT
/^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday), (?<day>\d{2})-(?<month>[a-z]{3})-(?<year>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) gmt$/i,
// Sun Nov  6 08:49:37 1994
/^(?:mon|tue|wed|thu|fri|sat|sun) (?<month>[a-z]{3}) (?<day> \d|\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) (?<year>\d{4})$/i];
const httpDateToMillis = input => {
  for (const format of httpDateFormats) {
    const groups = format.exec(input)?.groups;
    if (groups === undefined) continue;
    const month = monthNames.indexOf(groups.month.toLowerCase());
    const hour = Number(groups.hour);
    const minute = Number(groups.minute);
    const second = Number(groups.second);
    // the grammar allows 23:59:60 for a leap second
    if (month === -1 || hour > 23 || minute > 59 || second > 60) {
      return undefined;
    }
    // two-digit years use a fixed pivot, see parseHttpDate
    let year = Number(groups.year);
    if (groups.year.length === 2) {
      year += year < 70 ? 2000 : 1900;
    }
    const day = Number(groups.day);
    // setUTCFullYear keeps years below 100 as-is, unlike Date.UTC
    const date = new Date(0);
    date.setUTCFullYear(year, month, day);
    // an impossible day such as 31 Feb rolls over into the next month
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
      return undefined;
    }
    // a leap second cannot be represented in epoch time and reads as the
    // following second
    return date.getTime() + ((hour * 60 + minute) * 60 + second) * 1000;
  }
  return undefined;
};
/**
 * Parses an HTTP date header value into a UTC `DateTime`.
 *
 * **Details**
 *
 * Accepts the three formats of RFC 9110 §5.6.7: the preferred IMF-fixdate
 * (`Sun, 06 Nov 1994 08:49:37 GMT`), the obsolete RFC 850 format
 * (`Sunday, 06-Nov-94 08:49:37 GMT`) and the asctime format
 * (`Sun Nov  6 08:49:37 1994`). All three are read as UTC regardless of the
 * process time zone. Day and month names are case-insensitive, and the day
 * name is not checked against the date. A leap second (`23:59:60`) is read
 * as the following second, since epoch time cannot represent it.
 *
 * The two-digit year of the RFC 850 format is read with a fixed pivot:
 * `70`-`99` as 1970-1999 and `00`-`69` as 2000-2069. This deviates from
 * RFC 9110, which asks for the year to be chosen relative to the current
 * time so that it is never more than 50 years in the future. The fixed pivot
 * keeps parsing independent of the clock and matches most other HTTP
 * implementations.
 *
 * @stability unstable
 * @category header values
 * @since 4.0.0
 */
export const parseHttpDate = input => {
  const millis = httpDateToMillis(input.trim());
  return millis === undefined ? Result.fail(HeaderParseError.fromReason("InvalidHttpDate", input)) : Result.succeed(DateTime.makeUnsafe(millis));
};
/**
 * Formats a `DateTime` as an IMF-fixdate HTTP date, such as
 * `Sun, 06 Nov 1994 08:49:37 GMT`.
 *
 * @stability unstable
 * @category header values
 * @since 4.0.0
 */
export const formatHttpDate = self => DateTime.toDateUtc(self).toUTCString();
/**
 * Creates a `Retry-After` value from a delay.
 *
 * **Details**
 *
 * Infinite durations, positive or negative, have no header form and throw.
 * That check runs first; a finite negative duration then becomes zero.
 * Fractional seconds are kept, and {@link formatRetryAfter} rounds them up so
 * the header never asks for a shorter wait.
 *
 * A plain number is read as milliseconds, as everywhere in `Duration`: pass
 * `"120 seconds"` or `Duration.seconds(120)` for a two-minute delay.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export const retryAfterDuration = input => {
  const duration = Duration.fromInputUnsafe(input);
  if (!Duration.isFinite(duration)) {
    throw new Error("Cannot create a Retry-After value from an infinite duration");
  }
  return {
    _tag: "Duration",
    duration: Duration.isNegative(duration) ? Duration.zero : duration
  };
};
/**
 * Creates a `Retry-After` value from an HTTP date.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export const retryAfterDateTime = dateTime => ({
  _tag: "DateTime",
  dateTime
});
const wholeSeconds = /^\d+$/;
const nanosPerSecond = /*#__PURE__*/BigInt(1_000_000_000);
/**
 * Parses a `Retry-After` header value.
 *
 * **Details**
 *
 * Accepts whole non-negative seconds (`120`) of any size, read exactly, or an
 * HTTP date in any of the formats {@link parseHttpDate} accepts. Fractional,
 * negative, exponent and non-finite numbers are rejected, as are dates in
 * other formats.
 *
 * @stability unstable
 * @category header values
 * @since 4.0.0
 */
export const parseRetryAfter = input => {
  const trimmed = input.trim();
  if (wholeSeconds.test(trimmed)) {
    const seconds = Number(trimmed);
    // Keep the millisecond form while it is exact; beyond that, count nanos.
    const duration = Number.isSafeInteger(seconds * 1000) ? Duration.seconds(seconds) : Duration.nanos(BigInt(trimmed) * nanosPerSecond);
    return Result.succeed({
      _tag: "Duration",
      duration
    });
  }
  const millis = httpDateToMillis(trimmed);
  return millis === undefined ? Result.fail(HeaderParseError.fromReason("InvalidRetryAfter", input)) : Result.succeed(retryAfterDateTime(DateTime.makeUnsafe(millis)));
};
/**
 * Formats a `Retry-After` value as a header value: the delay as whole
 * seconds, or the date as an IMF-fixdate.
 *
 * **Details**
 *
 * A delay with a fractional second is rounded up, since `Retry-After` is the
 * least time to wait. Large delays are written as exact decimal digits.
 *
 * @stability unstable
 * @category header values
 * @since 4.0.0
 */
export const formatRetryAfter = self => self._tag === "Duration" ? String((Duration.toNanosUnsafe(self.duration) + nanosPerSecond - BigInt(1)) / nanosPerSecond) : formatHttpDate(self.dateTime);
/**
 * Computes how long to wait for a `Retry-After` value, measured from `now`
 * in epoch milliseconds.
 *
 * **Details**
 *
 * A date that is already in the past yields a zero duration, never a
 * negative one. Compute the delay when the retry is scheduled rather than
 * when the header is parsed, so the wait reflects the time already spent.
 *
 * @stability unstable
 * @category header values
 * @since 4.0.0
 */
export const retryAfterDelay = (self, now) => self._tag === "Duration" ? self.duration : Duration.millis(Math.max(0, DateTime.toEpochMillis(self.dateTime) - now));
/**
 * Provides an `Equivalence` instance for `Retry-After` values.
 *
 * @stability unstable
 * @category instances
 * @since 4.0.0
 */
export const RetryAfterEquivalence = (self, that) => self._tag === "Duration" ? that._tag === "Duration" && Duration.Equivalence(self.duration, that.duration) : that._tag === "DateTime" && DateTime.Equivalence(self.dateTime, that.dateTime);
//# sourceMappingURL=Headers.js.map