/**
 * Well-known directories for an application's persisted data.
 *
 * `UserDirectories` resolves where an application should keep its
 * configuration, data, cache and state, following the conventions of the host
 * platform. The resolved directories are what `KeyValueStore.layerFileSystem`
 * expects.
 *
 * **Example** (Backing a key-value store with the config directory)
 *
 * ```ts import.meta.vitest
 * import { Effect, Layer } from "effect"
 * import { KeyValueStore, UserDirectories } from "effect/persistence"
 *
 * const StoreLive = Layer.unwrap(
 *   Effect.gen(function*() {
 *     const dirs = yield* UserDirectories.UserDirectories
 *     return KeyValueStore.layerFileSystem(yield* dirs.config("myapp"))
 *   })
 * ).pipe(Layer.provide(UserDirectories.layer))
 * ```
 *
 * @stability unstable
 * @since 4.0.0
 */
import * as Config from "../Config.js";
import * as Context from "../Context.js";
import * as Effect from "../Effect.js";
import * as Layer from "../Layer.js";
import * as PlatformError from "../PlatformError.js";
/**
 * Identifies a `UserDirectories` service.
 *
 * @stability unstable
 * @category type ids
 * @since 4.0.0
 */
export const TypeId = "~effect/persistence/UserDirectories";
/**
 * Service tag for the user directory resolver.
 *
 * @stability unstable
 * @category services
 * @since 4.0.0
 */
export const UserDirectories = /*#__PURE__*/Context.Service(TypeId);
const isAbsolute = (platform, path) => platform === "win32" ? /^([a-zA-Z]:)?[\\/]/.test(path) : path.startsWith("/");
const join = (platform, base, ...segments) => platform === "win32" ? [base.replace(/[\\/]+$/, ""), ...segments].join("\\") : [base.replace(/\/+$/, ""), ...segments].join("/");
const xdgVariable = {
  config: "XDG_CONFIG_HOME",
  data: "XDG_DATA_HOME",
  cache: "XDG_CACHE_HOME",
  state: "XDG_STATE_HOME"
};
const windowsBase = (kind, env) => {
  if (env.appData !== undefined && isAbsolute("win32", env.appData)) {
    return env.appData;
  }
  if (env.home === undefined) {
    return undefined;
  }
  return join("win32", env.home, "AppData", kind === "config" || kind === "data" ? "Roaming" : "Local");
};
const posixBase = (platform, kind, home) => {
  if (platform === "darwin") {
    return join(platform, home, "Library", kind === "cache" ? "Caches" : "Application Support");
  }
  switch (kind) {
    case "config":
      return join(platform, home, ".config");
    case "data":
      return join(platform, home, ".local", "share");
    case "cache":
      return join(platform, home, ".cache");
    case "state":
      return join(platform, home, ".local", "state");
  }
};
const resolve = (platform, kind, appName, env) => {
  if (env.xdg !== undefined && isAbsolute(platform, env.xdg)) {
    return join(platform, env.xdg, appName);
  }
  if (platform === "win32") {
    const base = windowsBase(kind, env);
    if (base === undefined) {
      return undefined;
    }
    return kind === "cache" ? join(platform, base, appName, "Cache") : join(platform, base, appName);
  }
  if (env.home === undefined) {
    return undefined;
  }
  return join(platform, posixBase(platform, kind, env.home), appName);
};
/**
 * Creates a resolver that reads the environment from the current
 * `ConfigProvider` on every call, using the conventions of `platform`, which
 * defaults to the host platform.
 *
 * **Example** (Resolving for another platform)
 *
 * ```ts import.meta.vitest
 * import { ConfigProvider, Effect } from "effect"
 * import { UserDirectories } from "effect/persistence"
 *
 * const dirs = UserDirectories.make({ platform: "darwin" })
 *
 * const program = dirs.cache("myapp").pipe(
 *   Effect.provideService(
 *     ConfigProvider.ConfigProvider,
 *     ConfigProvider.fromEnv({ env: { HOME: "/Users/ada" } })
 *   )
 * )
 *
 * await Effect.runPromise(program) // => "/Users/ada/Library/Caches/myapp"
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export const make = options => {
  const platform = options?.platform ?? globalThis.process?.platform ?? "linux";
  const homeVariable = platform === "win32" ? "USERPROFILE" : "HOME";
  const optionalString = name => Config.String(name).pipe(Config.withDefault(undefined));
  const read = (method, config) => Effect.mapError(config, cause => PlatformError.systemError({
    _tag: "Unknown",
    module: "UserDirectories",
    method,
    description: "Failed to read the environment",
    cause
  }));
  const notFound = method => PlatformError.systemError({
    _tag: "NotFound",
    module: "UserDirectories",
    method,
    description: `${homeVariable} is not set`
  });
  const directory = kind => {
    const environment = Config.all({
      home: optionalString(homeVariable),
      xdg: optionalString(xdgVariable[kind]),
      appData: optionalString(kind === "config" || kind === "data" ? "APPDATA" : "LOCALAPPDATA")
    });
    return appName => Effect.flatMap(read(kind, environment), env => {
      const resolved = resolve(platform, kind, appName, env);
      return resolved === undefined ? Effect.fail(notFound(kind)) : Effect.succeed(resolved);
    });
  };
  return {
    [TypeId]: TypeId,
    home: Effect.flatMap(read("home", optionalString(homeVariable)), home => home === undefined ? Effect.fail(notFound("home")) : Effect.succeed(home)),
    config: directory("config"),
    data: directory("data"),
    cache: directory("cache"),
    state: directory("state")
  };
};
/**
 * Layer that resolves directories for the host platform.
 *
 * @stability unstable
 * @category layers
 * @since 4.0.0
 */
export const layer = /*#__PURE__*/Layer.sync(UserDirectories, () => make());
/**
 * Layer that resolves directories for the given platform, such as `"win32"`,
 * `"darwin"` or `"linux"`.
 *
 * @stability unstable
 * @category layers
 * @since 4.0.0
 */
export const layerPlatform = platform => Layer.sync(UserDirectories, () => make({
  platform
}));
//# sourceMappingURL=UserDirectories.js.map