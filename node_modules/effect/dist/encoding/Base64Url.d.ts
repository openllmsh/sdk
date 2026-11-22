/**
 * URL-safe Base64 encoding and decoding helpers.
 *
 * @stability stable
 * @since 4.0.0
 */
import * as Result from "../Result.ts";
import { EncodingError } from "./EncodingError.ts";
/**
 * Encodes the given value into an unpadded URL-safe Base64 string.
 *
 * **When to use**
 *
 * Use to encode text or bytes in contexts that require the URL-safe alphabet.
 *
 * **Details**
 *
 * String inputs are encoded as UTF-8 bytes before Base64Url encoding.
 * `Uint8Array` inputs are encoded directly. The output removes `=` padding
 * and replaces `+` with `-` and `/` with `_`.
 *
 * **Example** (Encoding URL-safe Base64)
 *
 * ```ts import.meta.vitest
 * import { Base64Url } from "effect/encoding"
 *
 * Base64Url.encode("hello?") // => "aGVsbG8_"
 *
 * const bytes = new Uint8Array([72, 101, 108, 108, 111, 63])
 * Base64Url.encode(bytes) // => "SGVsbG8_"
 * ```
 *
 * @see {@link encodePadded} for output that keeps `=` padding
 * @see {@link decode} for decoding URL-safe Base64 to bytes
 * @see {@link decodeString} for decoding URL-safe Base64 to UTF-8 text
 *
 * @stability stable
 * @category encoding
 * @since 4.0.0
 */
export declare const encode: (input: Uint8Array | string) => string;
/**
 * Encodes the given value into a padded URL-safe Base64 string.
 *
 * **When to use**
 *
 * Use when a consumer requires `=` padding on URL-safe Base64, such as Go's
 * `base64.URLEncoding`.
 *
 * **Details**
 *
 * Same as {@link encode}, but keeps the `=` padding. {@link decode} accepts
 * both forms.
 *
 * **Example** (Encoding padded URL-safe Base64)
 *
 * ```ts import.meta.vitest
 * import { Base64Url } from "effect/encoding"
 *
 * Base64Url.encodePadded("fo") // => "Zm8="
 * ```
 *
 * @see {@link encode} for unpadded output
 *
 * @stability stable
 * @category encoding
 * @since 4.0.6
 */
export declare const encodePadded: (input: Uint8Array | string) => string;
/**
 * Decodes a padded or unpadded URL-safe Base64 string into bytes safely.
 *
 * **When to use**
 *
 * Use to decode Base64Url text into bytes without throwing on invalid input.
 *
 * **Details**
 *
 * Returns `Result.succeed` with a `Uint8Array` when decoding succeeds, or
 * `Result.fail` with an `EncodingError` when the input is not valid
 * Base64Url. Both padded and unpadded forms are accepted when otherwise valid.
 *
 * **Example** (Decoding URL-safe Base64 bytes)
 *
 * ```ts import.meta.vitest
 * import { Result } from "effect"
 * import { Base64Url } from "effect/encoding"
 *
 * Base64Url.decode("SGVsbG8_") // => Result.succeed(new Uint8Array([72, 101, 108, 108, 111, 63]))
 * ```
 *
 * @stability stable
 * @category decoding
 * @since 4.0.0
 */
export declare const decode: (str: string) => Result.Result<Uint8Array, EncodingError>;
/**
 * Decodes a padded or unpadded URL-safe Base64 string into UTF-8 text safely.
 *
 * **When to use**
 *
 * Use to decode Base64Url text into UTF-8 text without throwing on invalid
 * input.
 *
 * **Details**
 *
 * Returns `Result.succeed` with the decoded text when decoding succeeds, or
 * `Result.fail` with an `EncodingError` when the input is not valid
 * Base64Url.
 *
 * **Example** (Decoding URL-safe Base64 strings)
 *
 * ```ts import.meta.vitest
 * import { Result } from "effect"
 * import { Base64Url } from "effect/encoding"
 *
 * Base64Url.decodeString("aGVsbG8_") // => Result.succeed("hello?")
 * ```
 *
 * @stability stable
 * @category decoding
 * @since 4.0.0
 */
export declare const decodeString: (str: string) => Result.Result<string, EncodingError>;
//# sourceMappingURL=Base64Url.d.ts.map