import * as Effect from "../Effect.ts";
import * as Layer from "../Layer.ts";
import * as Scope from "../Scope.ts";
import * as Migrator from "../sql/Migrator.ts";
import * as SqlClient from "../sql/SqlClient.ts";
import type { SqlError } from "../sql/SqlError.ts";
import * as RunnerStorage from "./RunnerStorage.ts";
import * as ShardingConfig from "./ShardingConfig.ts";
/**
 * Creates a SQL-backed `RunnerStorage` implementation for registered runners and
 * shard locks, using the configured table prefix and advisory locks where
 * supported and enabled.
 *
 * **When to use**
 *
 * Use to create a SQL-backed `RunnerStorage` value directly when building
 * custom service or layer composition around the storage implementation.
 *
 * **Details**
 *
 * `make` first runs the runner storage migrations, so the connection needs
 * permission to create tables. When `prefix` is omitted, `make` uses the
 * `cluster` prefix, creating `cluster_runners`, `cluster_locks`, and the
 * `cluster_runner_migrations` history table. PostgreSQL and MySQL use advisory
 * locks unless `ShardingConfig.shardLockDisableAdvisory` is enabled or the
 * client is PGlite; other dialects and PGlite use rows in the locks table.
 *
 * **Gotchas**
 *
 * Changing `prefix` changes all generated table names, so runners using
 * different prefixes do not share registrations or shard locks.
 *
 * @see {@link layer} for the default SQL-backed storage layer
 * @see {@link layerWith} for a SQL-backed storage layer with a custom table prefix
 * @see {@link layerStorage} for a storage layer that does not run migrations
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const make: (options: {
    readonly prefix?: string | undefined;
}) => Effect.Effect<RunnerStorage.RunnerStorage["Service"], SqlError, SqlClient.SqlClient | ShardingConfig.ShardingConfig | Scope.Scope>;
/**
 * Migration loader for the SQL runner storage tables.
 *
 * **Details**
 *
 * History is recorded in `<prefix>_runner_migrations`; the default
 * prefix is `cluster`. The locks table is created regardless of advisory lock settings.
 *
 * @stability unstable
 * @category migrations
 * @since 4.1.0
 */
export declare const migrations: (options: {
    readonly prefix?: string | undefined;
}) => Migrator.Loader;
/**
 * Runs the SQL runner storage migrations without providing storage.
 *
 * **Details**
 *
 * Use an owner connection in a deploy step, then use `layerStorage` with a
 * DML-only runtime connection. History is recorded in `<prefix>_runner_migrations`.
 * Migration errors become defects.
 * This layer does not require `ShardingConfig`.
 *
 * @stability unstable
 * @category layers
 * @since 4.1.0
 */
export declare const layerMigrations: (options: {
    readonly prefix?: string | undefined;
}) => Layer.Layer<never, never, SqlClient.SqlClient>;
/**
 * Provides SQL-backed `RunnerStorage` without DDL or startup schema checks.
 *
 * **Details**
 *
 * Run `layerMigrations` separately before using this layer.
 *
 * @stability unstable
 * @category layers
 * @since 4.1.0
 */
export declare const layerStorage: (options: {
    readonly prefix?: string | undefined;
}) => Layer.Layer<RunnerStorage.RunnerStorage, never, SqlClient.SqlClient | ShardingConfig.ShardingConfig>;
/**
 * Provides SQL-backed `RunnerStorage` with a custom table prefix,
 * running migrations first.
 *
 * **Details**
 *
 * The connection needs DDL permissions. PostgreSQL takes an exclusive lock
 * on the migration history table. Use `layerMigrations` and `layerStorage`
 * to migrate separately.
 *
 * @stability unstable
 * @category layers
 * @since 4.0.0
 */
export declare const layerWith: (options: {
    readonly prefix?: string | undefined;
}) => Layer.Layer<RunnerStorage.RunnerStorage, SqlError, SqlClient.SqlClient | ShardingConfig.ShardingConfig>;
/**
 * Layer that provides SQL-backed `RunnerStorage` using the default table prefix,
 * running the runner storage migrations first.
 *
 * @see {@link layerWith} for the same layer with a custom table prefix
 *
 * @stability unstable
 * @category layers
 * @since 4.0.0
 */
export declare const layer: Layer.Layer<RunnerStorage.RunnerStorage, SqlError, SqlClient.SqlClient | ShardingConfig.ShardingConfig>;
//# sourceMappingURL=SqlRunnerStorage.d.ts.map