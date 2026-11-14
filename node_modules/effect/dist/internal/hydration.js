import * as AsyncResult from "../reactivity/AsyncResult.js";
export const shouldHydrate = (current, incoming) => {
  if (!AsyncResult.isAsyncResult(current) || !AsyncResult.isAsyncResult(incoming)) {
    return true;
  }
  if (AsyncResult.isInitial(incoming)) {
    return AsyncResult.isInitial(current);
  }
  if (AsyncResult.isSuccess(current) && AsyncResult.isSuccess(incoming)) {
    return incoming.timestamp >= current.timestamp;
  }
  // Failures have no timestamp; previousSuccess dates cached data, not the error.
  return true;
};
//# sourceMappingURL=hydration.js.map