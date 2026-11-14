import * as Effect from "../../Effect.js";
import { identity } from "../../Function.js";
import * as Stream from "../../Stream.js";
import * as HttpBody from "../HttpBody.js";
/**
 * @internal
 */
export const compressionTransformWeb = format => stream => stream.pipeThrough(new CompressionStream(format));
/**
 * @internal
 */
export const singleChunkStream = data => new ReadableStream({
  start(controller) {
    controller.enqueue(data);
    controller.close();
  }
});
/**
 * @internal
 */
export const compressBody = (body, algorithm, options) => {
  if (body._tag !== "Uint8Array" && body._tag !== "Stream") {
    return Effect.succeed(body);
  }
  if (body.contentLength !== undefined && body.contentLength < (options?.minSize ?? 1024)) {
    return Effect.succeed(body);
  }
  if (body._tag === "Uint8Array") {
    return Effect.map(Effect.promise(() => new globalThis.Response(compressionTransformWeb(algorithm)(singleChunkStream(body.body))).arrayBuffer()), buffer => HttpBody.uint8Array(new Uint8Array(buffer), body.contentType));
  }
  return Effect.succeed(HttpBody.stream(Stream.fromReadableStream({
    evaluate: () => compressionTransformWeb(algorithm)(Stream.toReadableStream(body.stream)),
    onError: identity
  }), body.contentType));
};
//# sourceMappingURL=compressionBody.js.map