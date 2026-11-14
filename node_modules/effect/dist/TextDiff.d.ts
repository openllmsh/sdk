import * as Result from "./Result.ts";
declare const TextDiffErrorTypeId = "~effect/TextDiff/TextDiffError";
/**
 * One run of an edit script.
 *
 * **Details**
 *
 * `Equal` runs carry items kept from `before`, `Delete` runs carry items
 * removed from `before`, and `Insert` runs carry items added from `after`.
 * Scripts produced by this module never contain empty runs or two adjacent
 * runs with the same tag, and within each change the `Delete` run comes before
 * the `Insert` run.
 *
 * @see {@link diff} to compute an edit script
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export type Edit<A> = EditEqual<A> | EditInsert<A> | EditDelete<A>;
/**
 * Run of items present in both sequences.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface EditEqual<A> {
    readonly _tag: "Equal";
    readonly items: ReadonlyArray<A>;
}
/**
 * Run of items present only in the `after` sequence.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface EditInsert<A> {
    readonly _tag: "Insert";
    readonly items: ReadonlyArray<A>;
}
/**
 * Run of items present only in the `before` sequence.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface EditDelete<A> {
    readonly _tag: "Delete";
    readonly items: ReadonlyArray<A>;
}
declare const TextDiffError_base: new <A extends Record<string, any> = {}>(args: import("./Types.ts").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("./Cause.ts").YieldableError & {
    readonly _tag: "TextDiffError";
} & Readonly<A>;
/**
 * Error returned when an edit script does not fit the input it is applied to.
 *
 * **Example** (Rejecting a script made for other input)
 *
 * ```ts import.meta.vitest
 * import { Result, TextDiff } from "effect"
 *
 * const edits = TextDiff.diff([1, 2], [1])
 *
 * Result.mapError(TextDiff.apply([1], edits), TextDiff.isTextDiffError) // => Result.fail(true)
 * ```
 *
 * @see {@link apply} and {@link applyText} for the operations that return it
 * @see {@link isTextDiffError} for narrowing unknown values
 * @stability experimental
 * @category errors
 * @since 4.0.6
 */
export declare class TextDiffError extends TextDiffError_base<{
    readonly message: string;
}> {
    readonly [TextDiffErrorTypeId]: typeof TextDiffErrorTypeId;
}
/**
 * Checks whether a value is a `TextDiffError`.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.6
 */
export declare const isTextDiffError: (u: unknown) => u is TextDiffError;
/**
 * Creates a function that computes a minimal edit script between two arrays
 * using a custom equivalence.
 *
 * **When to use**
 *
 * Use when items should match by key or by a structural comparison other than
 * `Equal.equals`.
 *
 * **Details**
 *
 * Unless the `maxEdits` cap is exceeded, the script has the
 * fewest possible inserted plus deleted items. `Equal` runs carry the items
 * from `before`, not necessarily the exact values from `after`.
 *
 * **Gotchas**
 *
 * Without `maxEdits`, work grows with the product of the input size and the
 * number of differences, which is quadratic for unrelated inputs. Set
 * `maxEdits` for large or untrusted inputs.
 *
 * **Example** (Matching items by id)
 *
 * ```ts import.meta.vitest
 * import { TextDiff } from "effect"
 *
 * const diffById = TextDiff.diffWith<{ readonly id: number }>((a, b) => a.id === b.id)
 *
 * diffById([{ id: 1 }, { id: 2 }], [{ id: 2 }]) // => [{ _tag: "Delete", items: [{ id: 1 }] }, { _tag: "Equal", items: [{ id: 2 }] }]
 * ```
 *
 * @see {@link diff} for the `Equal.equals` variant
 * @stability experimental
 * @category constructors
 * @since 4.0.6
 */
export declare const diffWith: <A>(isEquivalent: (self: A, that: A) => boolean) => (before: ReadonlyArray<A>, after: ReadonlyArray<A>, options?: {
    /**
     * Largest number of inserted plus deleted items searched for in each
     * changed region. Common prefixes, suffixes and matching runs are free.
     * When a region needs more edits, the search splits it at the furthest
     * point it reached and continues on the rest, and a part that still cannot
     * be matched becomes a deletion followed by an insertion. The script stays
     * valid, and is minimal whenever the whole diff needs at most `maxEdits`
     * edits. For a finite cap, work is O((N + M) * (maxEdits + 1)).
     *
     * @default Infinity
     */
    readonly maxEdits?: number | undefined;
}) => Array<Edit<A>>;
/**
 * Computes a minimal edit script between two arrays, comparing items with
 * `Equal.equals`.
 *
 * **Details**
 *
 * Unless the `maxEdits` cap is exceeded, the script has the
 * fewest possible inserted plus deleted items. The choice is deterministic,
 * and each change lists its deletions before its insertions.
 *
 * **Gotchas**
 *
 * Without `maxEdits`, work is quadratic for unrelated inputs. Set `maxEdits`
 * when diffing large or untrusted arrays.
 *
 * **Example** (Diffing two arrays)
 *
 * ```ts import.meta.vitest
 * import { TextDiff } from "effect"
 *
 * TextDiff.diff([1, 2, 3, 4], [1, 3, 4, 5]) // => [{ _tag: "Equal", items: [1] }, { _tag: "Delete", items: [2] }, { _tag: "Equal", items: [3, 4] }, { _tag: "Insert", items: [5] }]
 * ```
 *
 * @see {@link diffWith} to compare items with a custom equivalence
 * @see {@link apply} to replay a script
 * @stability experimental
 * @category constructors
 * @since 4.0.6
 */
export declare const diff: <A>(before: ReadonlyArray<A>, after: ReadonlyArray<A>, options?: {
    /**
     * Largest number of inserted plus deleted items searched for in each
     * changed region. Common prefixes, suffixes and matching runs are free.
     * When a region needs more edits, the search splits it at the furthest
     * point it reached and continues on the rest, and a part that still cannot
     * be matched becomes a deletion followed by an insertion. The script stays
     * valid, and is minimal whenever the whole diff needs at most `maxEdits`
     * edits. For a finite cap, work is O((N + M) * (maxEdits + 1)).
     *
     * @default Infinity
     */
    readonly maxEdits?: number | undefined;
}) => Array<Edit<A>>;
/**
 * Computes a minimal line-level edit script between two strings.
 *
 * **Details**
 *
 * Each line keeps its `\n` terminator, so `\n` versus `\r\n` endings and a
 * missing final newline are reported as changes. Joining the items of a run
 * gives the exact text it covers.
 *
 * **Gotchas**
 *
 * Without `maxEdits`, work is quadratic for unrelated inputs. Set `maxEdits`
 * when diffing large or untrusted text.
 *
 * **Example** (Diffing lines)
 *
 * ```ts import.meta.vitest
 * import { TextDiff } from "effect"
 *
 * TextDiff.lines("a\nb\n", "a\nc\n") // => [{ _tag: "Equal", items: ["a\n"] }, { _tag: "Delete", items: ["b\n"] }, { _tag: "Insert", items: ["c\n"] }]
 * ```
 *
 * @see {@link codePoints} for a code point diff
 * @see {@link unified} to format a line diff
 * @stability experimental
 * @category constructors
 * @since 4.0.6
 */
export declare const lines: (before: string, after: string, options?: {
    /**
     * Largest number of inserted plus deleted items searched for in each
     * changed region. Common prefixes, suffixes and matching runs are free.
     * When a region needs more edits, the search splits it at the furthest
     * point it reached and continues on the rest, and a part that still cannot
     * be matched becomes a deletion followed by an insertion. The script stays
     * valid, and is minimal whenever the whole diff needs at most `maxEdits`
     * edits. For a finite cap, work is O((N + M) * (maxEdits + 1)).
     *
     * @default Infinity
     */
    readonly maxEdits?: number | undefined;
}) => Array<Edit<string>>;
/**
 * Computes a minimal code point edit script between two strings.
 *
 * **Details**
 *
 * Items are Unicode code points, so a surrogate pair is never split between
 * runs. Grapheme clusters, such as an emoji with modifiers or a letter with
 * combining marks, can still be split. The UTF-16 length of a run is the sum
 * of its items' lengths.
 *
 * **Gotchas**
 *
 * Without `maxEdits`, work is quadratic for unrelated inputs. Set `maxEdits`
 * when diffing large or untrusted text.
 *
 * **Example** (Diffing code points)
 *
 * ```ts import.meta.vitest
 * import { TextDiff } from "effect"
 *
 * TextDiff.codePoints("cat", "cut") // => [{ _tag: "Equal", items: ["c"] }, { _tag: "Delete", items: ["a"] }, { _tag: "Insert", items: ["u"] }, { _tag: "Equal", items: ["t"] }]
 * ```
 *
 * @see {@link lines} for a line diff
 * @see {@link applyText} to replay a script on a string
 * @stability experimental
 * @category constructors
 * @since 4.0.6
 */
export declare const codePoints: (before: string, after: string, options?: {
    /**
     * Largest number of inserted plus deleted items searched for in each
     * changed region. Common prefixes, suffixes and matching runs are free.
     * When a region needs more edits, the search splits it at the furthest
     * point it reached and continues on the rest, and a part that still cannot
     * be matched becomes a deletion followed by an insertion. The script stays
     * valid, and is minimal whenever the whole diff needs at most `maxEdits`
     * edits. For a finite cap, work is O((N + M) * (maxEdits + 1)).
     *
     * @default Infinity
     */
    readonly maxEdits?: number | undefined;
}) => Array<Edit<string>>;
/**
 * Applies an edit script to an array.
 *
 * **Details**
 *
 * `Equal` and `Delete` runs consume items from `before` by count, `Equal` runs
 * copy them to the result, and `Insert` runs add their items. Run contents are
 * not compared with `before`, since under a custom equivalence `Equal` items
 * can differ from the input.
 *
 * **Gotchas**
 *
 * Fails with a {@link TextDiffError} when the runs do not consume exactly
 * `before.length` items.
 *
 * **Example** (Replaying a script)
 *
 * ```ts import.meta.vitest
 * import { Result, TextDiff } from "effect"
 *
 * const edits = TextDiff.diff([1, 2, 3], [1, 3, 4])
 *
 * TextDiff.apply([1, 2, 3], edits) // => Result.succeed([1, 3, 4])
 * ```
 *
 * @see {@link applyText} for the string variant
 * @see {@link invert} to apply a script in reverse
 * @stability experimental
 * @category combinators
 * @since 4.0.6
 */
export declare const apply: <A>(before: ReadonlyArray<A>, edits: ReadonlyArray<Edit<A>>) => Result.Result<Array<A>, TextDiffError>;
/**
 * Applies a text edit script to a string.
 *
 * **Details**
 *
 * Works with scripts from both {@link lines} and {@link codePoints}. The
 * joined items of each `Equal` and `Delete` run must match `before` at the
 * current position, so a script made for different text is rejected rather
 * than applied.
 *
 * **Gotchas**
 *
 * Fails with a {@link TextDiffError} when a run does not match `before`, or
 * when the runs do not cover all of it.
 *
 * **Example** (Replaying a code point diff)
 *
 * ```ts import.meta.vitest
 * import { Result, TextDiff } from "effect"
 *
 * const edits = TextDiff.codePoints("cat", "cut")
 *
 * TextDiff.applyText("cat", edits) // => Result.succeed("cut")
 * ```
 *
 * @see {@link apply} for the array variant
 * @stability experimental
 * @category combinators
 * @since 4.0.6
 */
export declare const applyText: (before: string, edits: ReadonlyArray<Edit<string>>) => Result.Result<string, TextDiffError>;
/**
 * Inverts an edit script, so it turns `after` back into `before`.
 *
 * **Details**
 *
 * Swaps the items of each change's `Delete` and `Insert` runs, keeping
 * deletions before insertions. `Equal` runs are unchanged.
 *
 * **Example** (Undoing a change)
 *
 * ```ts import.meta.vitest
 * import { Result, TextDiff } from "effect"
 *
 * const edits = TextDiff.diff([1, 2], [1, 3])
 *
 * TextDiff.apply([1, 3], TextDiff.invert(edits)) // => Result.succeed([1, 2])
 * ```
 *
 * @stability experimental
 * @category combinators
 * @since 4.0.6
 */
export declare const invert: <A>(edits: ReadonlyArray<Edit<A>>) => Array<Edit<A>>;
/**
 * Formats a line edit script as a unified diff.
 *
 * **Details**
 *
 * The script must come from {@link lines}, or otherwise hold one line per
 * item. The output follows `diff -u`: hunks whose context would touch or
 * overlap are merged, and a final line without a newline is followed by
 * `\ No newline at end of file`. When `fromFile` or `toFile` is set, both
 * header lines are emitted and an unset name falls back to the other. A script
 * without changes produces an empty string.
 *
 * **Gotchas**
 *
 * Among equally small diffs, hunks can differ from those of GNU diff or Git,
 * which apply extra heuristics.
 *
 * **Example** (Formatting a unified diff)
 *
 * ```ts import.meta.vitest
 * import { TextDiff } from "effect"
 *
 * TextDiff.unified(TextDiff.lines("a\nb\n", "a\nc\n")) // => "@@ -1,2 +1,2 @@\n a\n-b\n+c\n"
 * ```
 *
 * @see {@link lines} to compute a line diff
 * @stability experimental
 * @category formatting
 * @since 4.0.6
 */
export declare const unified: (edits: ReadonlyArray<Edit<string>>, options?: {
    /**
     * Number of unchanged lines shown around each change.
     *
     * @default 3
     */
    readonly context?: number | undefined;
    /**
     * Name shown in the `---` header line.
     */
    readonly fromFile?: string | undefined;
    /**
     * Name shown in the `+++` header line.
     */
    readonly toFile?: string | undefined;
}) => string;
export {};
//# sourceMappingURL=TextDiff.d.ts.map