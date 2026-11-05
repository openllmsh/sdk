import { Option, Schema as S, SchemaGetter } from "effect";

/**
 * v3 `optionalToOptional` dropped blank values by returning `Option.none`.
 * `decodeTo` preserves that behaviour: an absent key, `undefined`, or a
 * whitespace-only string is omitted, while a nonempty ID is preserved exactly.
 */
/** Public selection input only; concrete provider requests still require a model. */
const optionalMediaModelDescription =
  "Optional model ID. Omit for automatic default-chain selection; never send an empty-string placeholder. Preserve an explicitly selected nonempty ID exactly.";

/**
 * The wire representation is an exact optional string: `undefined` cannot
 * occur in JSON, so documenting it as `null` would invite invalid requests.
 */
export const OptionalMediaModel = S.optionalKey(S.String).pipe(
  S.decodeTo(S.optionalKey(S.String), {
    decode: SchemaGetter.transformOptional(
      (value: Option.Option<string>): Option.Option<string> =>
        Option.filter(value, (model): model is string => model.trim() !== ""),
    ),
    encode: SchemaGetter.transformOptional(
      (value: Option.Option<string>): Option.Option<string> => value,
    ),
  }),
  S.annotateEncoded({ description: optionalMediaModelDescription }),
);
export const MediaModelSelection = S.Struct({ model: OptionalMediaModel });
const decodeMediaModelSelectionSchema =
  S.decodeUnknownSync(MediaModelSelection);

/**
 * JavaScript callers can pass `undefined` even though it has no JSON wire
 * representation. Normalize it to an omitted optional key before validation.
 */
export const decodeMediaModelSelection = (input: {
  readonly model?: unknown;
}): { readonly model?: string } =>
  input.model === undefined ? {} : decodeMediaModelSelectionSchema(input);

const VideoReferenceList = S.Array(S.String.check(S.isMinLength(1)));
/** Empty reference lists carry no guidance; invalid entries and wrong types still fail. */
export const OptionalVideoReferences = S.optionalKey(VideoReferenceList).pipe(
  S.decodeTo(S.optionalKey(VideoReferenceList), {
    decode: SchemaGetter.transformOptional(
      (
        value: Option.Option<readonly string[]>,
      ): Option.Option<readonly string[]> =>
        Option.filter(
          value,
          (references): references is readonly string[] =>
            references.length > 0,
        ),
    ),
    encode: SchemaGetter.transformOptional(
      (
        value: Option.Option<readonly string[]>,
      ): Option.Option<readonly string[]> => value,
    ),
  }),
);
