/**
 * Returns the original Web `Response` of a fetch-backed client response.
 * Wrappers forward it to the response they wrap.
 *
 * @internal
 */
export const WebSourceSymbol = "~effect/http/HttpClientResponse/WebSource";
/**
 * @internal
 */
export const getWebSource = self => self[WebSourceSymbol]?.();
//# sourceMappingURL=webResponse.js.map