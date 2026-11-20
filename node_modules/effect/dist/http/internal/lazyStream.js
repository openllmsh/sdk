import * as Channel from "../../Channel.js";
import * as Effect from "../../Effect.js";
import * as Stream from "../../Stream.js";
/**
 * Opens `stream` on its first pull rather than when it is run, so a consumer
 * that runs it without pulling, such as a Web `ReadableStream`, leaves the
 * body unread.
 *
 * @internal
 */
export const openOnFirstPull = stream => Stream.fromChannel(Channel.fromTransform((_, scope) => Effect.sync(() => {
  let pull;
  return Effect.suspend(() => pull ?? Effect.flatMap(Channel.toPullScoped(stream.channel, scope), upstream => {
    pull = upstream;
    return upstream;
  }));
})));
//# sourceMappingURL=lazyStream.js.map