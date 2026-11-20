import * as Context from "../../Context.js";
import * as Effect from "../../Effect.js";
/**
 * Mutable state owned by the root that handles a single server request.
 *
 * @internal
 */
export class RequestState {
  preResponseHandler = undefined;
  loggerDisabled = false;
}
/**
 * Provided by request roots alongside `HttpServerRequest`. It has no default,
 * so writes outside a request do not reach shared state.
 *
 * @internal
 */
export const CurrentRequestState = /*#__PURE__*/Context.Service("effect/http/HttpEffect/CurrentRequestState");
/**
 * @internal
 */
export const appendPreResponseHandlerUnsafe = (context, handler) => {
  const state = Context.getOrUndefined(context, CurrentRequestState);
  if (state === undefined) return;
  const prev = state.preResponseHandler;
  state.preResponseHandler = prev ? (request, response) => Effect.flatMap(prev(request, response), response => handler(request, response)) : handler;
};
//# sourceMappingURL=requestState.js.map