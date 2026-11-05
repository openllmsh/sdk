/**
 * Named execution variants and composable capture — public wire vocabulary.
 *
 * Distinct, provider-unprefixed integration ids. `ACTIVE_SUB_METHOD` is the
 * ONLY selector (global + `provider:method` override grammar); this module
 * defines its token vocabulary and the typed wire shapes it carries.
 *
 * See `docs/plan/bridge-variants-and-capture-adapters/00-requirements.md`
 * and `09-implementation-plan.md` §4 for the approved naming baseline and
 * selection model. `12-hermes-adoption-plan.md` is the reference for the
 * planned `sdk-facade` implementation — NOT built here; this module only
 * reserves its wire vocabulary.
 *
 * - `stream-json` — Claude direct CLI (stream-json protocol)
 * - `agent-sdk` — official Claude Agent SDK, if independently selectable
 *   (reserved; no `-capture` form is defined for it in this baseline)
 * - `sdk-facade` — planned Hermes-inspired Claude completion facade
 * - `acp` — Cursor and future ACP-protocol providers
 * - `app-server` — Codex
 * - `msp` — Muse
 * - `handrolled` — hand-rolled execution (never vendor-controlled, so it
 *   never carries `-capture`)
 */

import { Schema as S } from "effect";

/**
 * Stable, provider-unprefixed integration ids — the specific vendor-
 * controlled integration API a hop drives, not a generic "CLI"/"SDK"
 * bucket. Closed: a new variant is a deliberate, reviewable schema change.
 */
export const BridgeVariant = S.Literals([
  "stream-json",
  "agent-sdk",
  "sdk-facade",
  "acp",
  "app-server",
  "msp",
]);
export type TBridgeVariant = S.Schema.Type<typeof BridgeVariant>;

/**
 * Every registered {@link TBridgeVariant}, for enumeration/tests. Order
 * matches the naming baseline in 00-requirements.md.
 */
export const BRIDGE_VARIANTS: ReadonlyArray<TBridgeVariant> =
  BridgeVariant.literals;

export const isBridgeVariant = (value: string): value is TBridgeVariant =>
  (BridgeVariant.literals as ReadonlyArray<string>).includes(value);

/**
 * Which variants have a defined `<variant>-capture` form. Per the approved
 * naming baseline, every variant has one EXCEPT `agent-sdk` — it is
 * reserved for the official Agent SDK as an independently selectable
 * integration, and no capture form for it is part of this baseline. A
 * capture form existing here means the NAME is grammatically valid; it is
 * NOT a claim that any given provider's binding is capture-ready (that is
 * the provider execution registry's job — see
 * `packages/cli/daemon/src/execution-registry.ts`).
 */
export const BRIDGE_VARIANTS_WITH_CAPTURE_FORM: ReadonlySet<TBridgeVariant> =
  new Set(["stream-json", "sdk-facade", "acp", "app-server", "msp"]);

export const bridgeVariantSupportsCaptureForm = (
  variant: TBridgeVariant,
): boolean => BRIDGE_VARIANTS_WITH_CAPTURE_FORM.has(variant);

/**
 * A concrete, resolved execution selection: either `handrolled` (never
 * vendor-controlled, so it structurally has no `variant`/`capture` fields
 * and `handrolled-capture` cannot be represented) or a bridge variant with
 * its capture flag.
 */
export const ExecutionSelectionHandrolled = S.Struct({
  kind: S.Literal("handrolled"),
});
export const ExecutionSelectionBridge = S.Struct({
  kind: S.Literal("bridge"),
  variant: BridgeVariant,
  capture: S.Boolean,
});
export const ExecutionSelection = S.Union([
  ExecutionSelectionHandrolled,
  ExecutionSelectionBridge,
]);
export type TExecutionSelection = S.Schema.Type<typeof ExecutionSelection>;

export const executionSelectionHandrolled = (): TExecutionSelection => ({
  kind: "handrolled",
});

export const executionSelectionBridge = (
  variant: TBridgeVariant,
  capture: boolean,
): TExecutionSelection => ({ kind: "bridge", variant, capture });

const CAPTURE_SUFFIX = "-capture";

/**
 * Parse one `ACTIVE_SUB_METHOD` token (a bare method, not a
 * `provider:method` pair — callers split that first): `handrolled` or any
 * `<variant>`/`<variant>-capture` combination that
 * {@link bridgeVariantSupportsCaptureForm} allows. Returns `null` for
 * anything else, INCLUDING `handrolled-capture` — capture requires
 * vendor-controlled execution, which `handrolled` by definition is not, so
 * it is excluded structurally here rather than merely rejected downstream.
 * Case-sensitive lowercase only, matching the existing `ACTIVE_SUB_METHOD`
 * convention.
 */
export const parseActiveExecutionToken = (
  token: string,
): TExecutionSelection | null => {
  if (token === "handrolled") return executionSelectionHandrolled();
  const capture = token.endsWith(CAPTURE_SUFFIX);
  const base = capture ? token.slice(0, -CAPTURE_SUFFIX.length) : token;
  if (base.length === 0 || !isBridgeVariant(base)) return null;
  if (capture && !bridgeVariantSupportsCaptureForm(base)) return null;
  return executionSelectionBridge(base, capture);
};

/** Inverse of {@link parseActiveExecutionToken} — for diagnostics/logging. */
export const formatActiveExecutionToken = (
  token: TExecutionSelection,
): string => {
  if (token.kind === "handrolled") return "handrolled";
  return token.capture ? `${token.variant}${CAPTURE_SUFFIX}` : token.variant;
};

/**
 * Every valid public token, for enumeration/tests.
 * `handrolled-capture` is deliberately absent — it is never valid.
 */
export const ACTIVE_EXECUTION_TOKENS: ReadonlyArray<string> = [
  "handrolled",
  ...BRIDGE_VARIANTS.flatMap((variant) =>
    bridgeVariantSupportsCaptureForm(variant)
      ? [variant, `${variant}${CAPTURE_SUFFIX}`]
      : [variant],
  ),
];
