import * as Context from "../../Context.js";
import * as Effect from "../../Effect.js";
import * as CliOutput from "../CliOutput.js";
import * as TerminalCapabilities from "../TerminalCapabilities.js";
/**
 * The formatter for built-in command output. An installed `CliOutput.Formatter`
 * wins, otherwise the default formatter colors when `TerminalCapabilities`
 * says it can.
 *
 * @internal
 */
export const resolveFormatter = /*#__PURE__*/Effect.contextWith(context => Effect.succeed(Context.getOrUndefined(context, CliOutput.Formatter) ?? CliOutput.defaultFormatter({
  colors: Context.get(context, TerminalCapabilities.TerminalCapabilities).canColor
})));
//# sourceMappingURL=formatter.js.map