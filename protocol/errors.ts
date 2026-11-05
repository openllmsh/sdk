import { Schema as S } from "effect";

export const ErrorBody = S.Struct({
  message: S.String,
  type: S.String,
  code: S.optional(S.String),
  param: S.optional(S.NullOr(S.String)),
});
export type TErrorBody = S.Schema.Type<typeof ErrorBody>;

export const ErrorEnvelope = S.Struct({
  error: ErrorBody,
});
export type TErrorEnvelope = S.Schema.Type<typeof ErrorEnvelope>;
