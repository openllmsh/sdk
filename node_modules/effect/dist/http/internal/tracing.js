import * as Headers from "../Headers.js";
import * as UrlParams from "../UrlParams.js";
const defaultPorts = {
  "http:": 80,
  "https:": 443,
  "ws:": 80,
  "wss:": 443
};
/**
 * Records `url.*` and `server.*` attributes with URL redaction.
 *
 * @internal
 */
export const addUrlAttributes = (span, url, redactedNames) => {
  const query = UrlParams.redactUrl(url.search, redactedNames).slice(1);
  span.attribute("url.full", UrlParams.redactUrl(url.href, redactedNames));
  span.attribute("url.path", url.pathname);
  if (query !== "") {
    span.attribute("url.query", query);
  }
  span.attribute("url.scheme", url.protocol.slice(0, -1));
  if (url.hostname !== "") {
    // URL keeps IPv6 brackets in the hostname, but the semantic conventions do not.
    span.attribute("server.address", url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname);
    const port = url.port === "" ? defaultPorts[url.protocol] : Number(url.port);
    if (port !== undefined) {
      span.attribute("server.port", port);
    }
  }
};
/**
 * Adds the names of `Redacted` parameters to the redacted names.
 *
 * @internal
 */
export const redactedNames = (urlParams, redactedNames) => {
  const keys = urlParams.params.filter(([, value]) => typeof value !== "string").map(([key]) => key);
  return keys.length === 0 ? redactedNames : [...redactedNames, ...new URLSearchParams(keys.map(key => [key, ""])).keys()];
};
/** @internal */
export const addHeaderAttributes = (span, phase, headers, filter, redactedNames) => {
  for (const name in headers) {
    if (!filter(name, phase)) continue;
    span.attribute(`http.${phase}.header.${name}`, Headers.isRedactedName(name, redactedNames) ? "<redacted>" : headers[name]);
  }
};
//# sourceMappingURL=tracing.js.map