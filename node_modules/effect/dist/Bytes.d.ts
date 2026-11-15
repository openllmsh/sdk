/**
 * Joins and compares byte sequences stored in `Uint8Array` values.
 *
 * Byte-to-text conversions live in `TextEncoder` / `TextDecoder`, and hex or
 * base64 conversions live in the `Encoding` modules.
 *
 * @stability unstable
 * @since 4.0.6
 */
import * as Equ from "./Equivalence.ts";
import * as order from "./Order.ts";
/**
 * Joins byte chunks into one new `Uint8Array`.
 *
 * **When to use**
 *
 * Use to combine frames, headers, or streamed chunks into a single buffer.
 *
 * **Gotchas**
 *
 * The result is always a new array, even when there is zero or one chunk, so
 * it never aliases an input.
 *
 * **Example** (Joining byte chunks)
 *
 * ```ts import.meta.vitest
 * import { Bytes } from "effect"
 *
 * const bytes = Bytes.concat([new Uint8Array([1, 2]), new Uint8Array([3])])
 * Array.from(bytes) // => [1, 2, 3]
 * ```
 *
 * @stability unstable
 * @category combinators
 * @since 4.0.6
 */
export declare const concat: (chunks: ReadonlyArray<Uint8Array>) => Uint8Array<ArrayBuffer>;
/**
 * Compares byte sequences for equality, byte by byte.
 *
 * **Gotchas**
 *
 * This returns as soon as a byte differs, so it is not constant-time. Do not
 * use it to compare secrets.
 *
 * **Example** (Comparing byte sequences)
 *
 * ```ts import.meta.vitest
 * import { Bytes } from "effect"
 *
 * Bytes.Equivalence(new Uint8Array([1, 2]), new Uint8Array([1, 2])) // => true
 * Bytes.Equivalence(new Uint8Array([1, 2]), new Uint8Array([1])) // => false
 * ```
 *
 * @stability unstable
 * @category instances
 * @since 4.0.6
 */
export declare const Equivalence: Equ.Equivalence<Uint8Array>;
/**
 * Orders byte sequences lexicographically by unsigned byte value, placing a
 * prefix before any longer sequence that starts with it.
 *
 * **Example** (Sorting byte sequences)
 *
 * ```ts import.meta.vitest
 * import { Bytes } from "effect"
 *
 * Bytes.Order(new Uint8Array([1, 2]), new Uint8Array([1, 3])) // => -1
 * Bytes.Order(new Uint8Array([2]), new Uint8Array([1, 9])) // => 1
 * Bytes.Order(new Uint8Array([1]), new Uint8Array([1, 0])) // => -1
 * ```
 *
 * @stability unstable
 * @category instances
 * @since 4.0.6
 */
export declare const Order: order.Order<Uint8Array>;
//# sourceMappingURL=Bytes.d.ts.map