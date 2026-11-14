/**
 * Names the span after the RPC method, or `${spanPrefix}.${tag}` when a prefix
 * is configured.
 *
 * @internal
 */
export const spanName = (spanPrefix, tag) => spanPrefix === undefined ? tag : `${spanPrefix}.${tag}`;
/**
 * Default RPC span attributes, overridden by user `spanAttributes`.
 *
 * @internal
 */
export const spanAttributes = (tag, attributes) => ({
  "rpc.system.name": "effect_rpc",
  "rpc.method": tag,
  ...attributes
});
//# sourceMappingURL=tracing.js.map