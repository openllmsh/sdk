import * as Context from "../Context.ts";
import * as Effect from "../Effect.ts";
import * as Layer from "../Layer.ts";
import * as PlatformError from "../PlatformError.ts";
/**
 * Identifies a `UserDirectories` service.
 *
 * @stability unstable
 * @category type ids
 * @since 4.0.0
 */
export declare const TypeId: TypeId;
/**
 * Type of the `UserDirectories` type id.
 *
 * @stability unstable
 * @category type ids
 * @since 4.0.0
 */
export type TypeId = "~effect/persistence/UserDirectories";
/**
 * Resolves the directories where an application keeps its files.
 *
 * **Details**
 *
 * An absolute `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` or
 * `XDG_STATE_HOME` is used on every platform, with the application name
 * appended. A relative one is ignored. Otherwise the native location is used:
 *
 * | kind   | Windows                                | macOS                          | other            |
 * | ------ | -------------------------------------- | ------------------------------ | ---------------- |
 * | config | `%APPDATA%`                            | `~/Library/Application Support` | `~/.config`      |
 * | data   | `%APPDATA%`                            | `~/Library/Application Support` | `~/.local/share` |
 * | cache  | `%LOCALAPPDATA%`, then `\Cache` suffix | `~/Library/Caches`             | `~/.cache`       |
 * | state  | `%LOCALAPPDATA%`                       | `~/Library/Application Support` | `~/.local/state` |
 *
 * `APPDATA` and `LOCALAPPDATA` are used when absolute and otherwise replaced
 * by `%USERPROFILE%\AppData\Roaming` and `%USERPROFILE%\AppData\Local`.
 *
 * **Gotchas**
 *
 * `config` and `data` resolve to the same directory on Windows and macOS, and
 * `state` joins them on macOS. That is the native convention. Keep each kind
 * in its own subdirectory when the same application uses more than one, since
 * `KeyValueStore.layerFileSystem` clears a directory recursively.
 *
 * @stability unstable
 * @category models
 * @since 4.0.0
 */
export interface UserDirectories {
    readonly [TypeId]: TypeId;
    /**
     * The current user's home directory.
     */
    readonly home: Effect.Effect<string, PlatformError.PlatformError>;
    /**
     * Where `appName` keeps its settings.
     */
    readonly config: (appName: string) => Effect.Effect<string, PlatformError.PlatformError>;
    /**
     * Where `appName` keeps data it cannot regenerate.
     */
    readonly data: (appName: string) => Effect.Effect<string, PlatformError.PlatformError>;
    /**
     * Where `appName` keeps data it can regenerate.
     */
    readonly cache: (appName: string) => Effect.Effect<string, PlatformError.PlatformError>;
    /**
     * Where `appName` keeps logs, history and other state that is not user data.
     */
    readonly state: (appName: string) => Effect.Effect<string, PlatformError.PlatformError>;
}
/**
 * Service tag for the user directory resolver.
 *
 * @stability unstable
 * @category services
 * @since 4.0.0
 */
export declare const UserDirectories: Context.Service<UserDirectories, UserDirectories>;
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
export declare const make: (options?: {
    readonly platform?: string | undefined;
}) => UserDirectories;
/**
 * Layer that resolves directories for the host platform.
 *
 * @stability unstable
 * @category layers
 * @since 4.0.0
 */
export declare const layer: Layer.Layer<UserDirectories>;
/**
 * Layer that resolves directories for the given platform, such as `"win32"`,
 * `"darwin"` or `"linux"`.
 *
 * @stability unstable
 * @category layers
 * @since 4.0.0
 */
export declare const layerPlatform: (platform: string) => Layer.Layer<UserDirectories>;
//# sourceMappingURL=UserDirectories.d.ts.map