/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source of truth: the static model catalog's rows carrying
 * `capabilities: ["realtime"]` (`packages/api/catalog/models/*`).
 * Regenerate with:
 *
 *     bun run build:realtime-generated
 *
 * `scripts/check-realtime-generated.ts` (`bun run check:realtime-generated`)
 * fails when this artifact drifts from the catalog.
 *
 * WHY THIS IS GENERATED RATHER THAN LOOKED UP — the documented exception:
 * the realtime model id is decoded by the SHIPPED daemon binary at mux
 * admission (`RealtimeStreamOpenPayload`), so it must be a literal owned by
 * `protocol`. `protocol` cannot import `packages/api` (layering), and a
 * runtime catalog read would add a daemon -> API dependency at admission time
 * and break decode compatibility with deployed binaries. Generating keeps the
 * catalog as the ONE source while leaving the wire literal static.
 *
 * This artifact carries ids only — never catalog metadata — and asserts
 * nothing about availability.
 */

/** Every realtime `provider_model_id` the catalog declares. */
export const REALTIME_MODEL_IDS = ["grok-voice-latest"] as const;

/** The id each realtime provider dials by default. */
export const REALTIME_DEFAULT_MODEL_BY_PROVIDER = {
  grok: "grok-voice-latest",
} as const;
