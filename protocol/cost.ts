import { Schema as S } from "effect";

export const CostBreakdown = S.Struct({
  input_cost_usd: S.Number,
  output_cost_usd: S.Number,
  cache_read_cost_usd: S.Number,
  cache_write_cost_usd: S.Number,
  total_cost_usd: S.Number,
});
export type TCostBreakdown = S.Schema.Type<typeof CostBreakdown>;
