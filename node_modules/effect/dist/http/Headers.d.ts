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
import * as Context from "../Context.ts";
import * as Data from "../Data.ts";
import * as DateTime from "../DateTime.ts";
import * as Duration from "../Duration.ts";
import * as Equ from "../Equivalence.ts";
import * as Option from "../Option.ts";
import * as Record from "../Record.ts";
import * as Redactable from "../Redactable.ts";
import * as Redacted from "../Redacted.ts";
import * as Result from "../Result.ts";
/**
 * Runtime type identifier for `Headers` values.
 *
 * @stability unstable
 * @category type IDs
 * @since 4.0.0
 */
export declare const TypeId: unique symbol;
/**
 * Type of the unique symbol used to brand `Headers` values.
 *
 * @stability unstable
 * @category type IDs
 * @since 4.0.0
 */
export type TypeId = typeof TypeId;
/**
 * Returns `true` if the provided value is a `Headers` value.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isHeaders: (u: unknown) => u is Headers;
/**
 * Represents an immutable HTTP header collection keyed by lowercase header name.
 *
 * **Details**
 *
 * `Headers` values also support redaction through the `Redactable` protocol.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface Headers extends Redactable.Redactable {
    readonly [TypeId]: TypeId;
    readonly [key: string]: string;
}
/**
 * Provides an `Equivalence` instance that compares `Headers` by header names
 * and string values.
 *
 * @stability unstable
 * @category instances
 * @since 4.0.0
 */
export declare const Equivalence: Equ.Equivalence<Headers>;
/**
 * Input accepted when constructing headers.
 *
 * **Details**
 *
 * Records may contain string values, string arrays, or `undefined`; arrays are joined with `", "`, and `undefined` values are omitted.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type Input = Record.ReadonlyRecord<string, string | ReadonlyArray<string> | undefined> | Iterable<readonly [string, string]>;
/**
 * An empty `Headers` collection.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const empty: Headers;
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
export declare const fromInput: (input?: Input) => Headers;
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
export declare const fromRecordUnsafe: (input: Record.ReadonlyRecord<string, string>) => Headers;
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
export declare const has: {
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
    (key: string): (self: Headers) => boolean;
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
    (self: Headers, key: string): boolean;
};
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
export declare const get: {
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
    (key: string): (self: Headers) => Option.Option<string>;
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
    (self: Headers, key: string): Option.Option<string>;
};
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
export declare const set: {
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
    (key: string, value: string): (self: Headers) => Headers;
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
    (self: Headers, key: string, value: string): Headers;
};
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
export declare const setAll: {
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
    (headers: Input): (self: Headers) => Headers;
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
    (self: Headers, headers: Input): Headers;
};
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
export declare const merge: {
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
    (headers: Headers): (self: Headers) => Headers;
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
    (self: Headers, headers: Headers): Headers;
};
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
export declare const remove: {
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
    (key: string): (self: Headers) => Headers;
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
    (self: Headers, key: string): Headers;
};
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
export declare const removeMany: {
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
    (keys: Iterable<string>): (self: Headers) => Headers;
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
    (self: Headers, keys: Iterable<string>): Headers;
};
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
export declare const redact: {
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
    (key: string | RegExp | ReadonlyArray<string | RegExp>): (self: Headers) => Record<string, string | Redacted.Redacted>;
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
    (self: Headers, key: string | RegExp | ReadonlyArray<string | RegExp>): Record<string, string | Redacted.Redacted>;
};
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
export declare const isRedactedName: (name: string, patterns: ReadonlyArray<string | RegExp>) => boolean;
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
export declare const CurrentRedactedNames: Context.Reference<readonly (string | RegExp)[]>;
declare const HeaderParseErrorTypeId = "~effect/http/Headers/HeaderParseError";
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
export declare class HeaderParseErrorReason extends Data.Error<{
    readonly _tag: "InvalidHttpDate" | "InvalidRetryAfter";
    readonly input: string;
}> {
}
declare const HeaderParseError_base: new <A extends Record<string, any> = {}>(args: import("../Types.ts").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("../Cause.ts").YieldableError & {
    readonly _tag: "HeaderParseError";
} & Readonly<A>;
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
export declare class HeaderParseError extends HeaderParseError_base<{
    readonly reason: HeaderParseErrorReason;
}> {
    /**
     * Creates a header parse error from a reason tag and the rejected input.
     *
     * @stability unstable
     * @since 4.0.0
     */
    static fromReason(reason: HeaderParseError["reason"]["_tag"], input: string): HeaderParseError;
    /**
     * Marks this value as a header parse error for runtime guards.
     *
     * @stability unstable
     * @since 4.0.0
     */
    readonly [HeaderParseErrorTypeId] = "~effect/http/Headers/HeaderParseError";
    /**
     * Names the failed header and the rejected input.
     *
     * @stability unstable
     * @since 4.0.0
     */
    get message(): string;
}
/**
 * Checks whether a value is a `HeaderParseError`.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.0
 */
export declare const isHeaderParseError: (u: unknown) => u is HeaderParseError;
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
export declare const parseHttpDate: (input: string) => Result.Result<DateTime.Utc, HeaderParseError>;
/**
 * Formats a `DateTime` as an IMF-fixdate HTTP date, such as
 * `Sun, 06 Nov 1994 08:49:37 GMT`.
 *
 * @stability unstable
 * @category header values
 * @since 4.0.0
 */
export declare const formatHttpDate: (self: DateTime.DateTime) => string;
/**
 * A `Retry-After` value given as a delay.
 *
 * **Details**
 *
 * The duration is always finite and non-negative. On the wire it is written
 * as whole seconds, rounded up.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface RetryAfterDuration {
    readonly _tag: "Duration";
    readonly duration: Duration.Duration;
}
/**
 * A `Retry-After` value given as an HTTP date.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface RetryAfterDateTime {
    readonly _tag: "DateTime";
    readonly dateTime: DateTime.Utc;
}
/**
 * Represents a parsed `Retry-After` header value.
 *
 * **Details**
 *
 * The header carries either a delay in whole seconds or an absolute HTTP
 * date. Use {@link retryAfterDelay} to turn either form into a `Duration`
 * measured from a given instant.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export type RetryAfter = RetryAfterDuration | RetryAfterDateTime;
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
export declare const retryAfterDuration: (input: Duration.Input) => RetryAfter;
/**
 * Creates a `Retry-After` value from an HTTP date.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const retryAfterDateTime: (dateTime: DateTime.Utc) => RetryAfter;
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
export declare const parseRetryAfter: (input: string) => Result.Result<RetryAfter, HeaderParseError>;
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
export declare const formatRetryAfter: (self: RetryAfter) => string;
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
export declare const retryAfterDelay: (self: RetryAfter, now: number) => Duration.Duration;
/**
 * Provides an `Equivalence` instance for `Retry-After` values.
 *
 * @stability unstable
 * @category instances
 * @since 4.0.0
 */
export declare const RetryAfterEquivalence: Equ.Equivalence<RetryAfter>;
export {};
//# sourceMappingURL=Headers.d.ts.map