import * as Effect from "../Effect.ts";
import * as Layer from "../Layer.ts";
import * as SqlClient from "../sql/SqlClient.ts";
import * as SqlError from "../sql/SqlError.ts";
import * as EventJournal from "./EventJournal.ts";
/**
 * Creates an `EventJournal` backed by a SQL database.
 *
 * **Details**
 *
 * Maintains `entryTable`, `${entryTable}_sequence`, `${entryTable}_sources`,
 * `${remotesTable}_checkpoints` and `remoteCursorsTable` (default
 * `${remotesTable}_cursors`) using the configured `SqlClient`.
 *
 * **Gotchas**
 *
 * Creating or migrating the schema requires a writable connection. Migrated
 * databases can be reopened read-only.
 *
 * Journals from earlier releases keep one `remotesTable` row per entry per
 * remote. Opening one replaces those rows with entry sources and drops the
 * table; an entry known to several remotes keeps one of them as its source.
 *
 * Upload acknowledgements do not advance past unseen entries.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.0
 */
export declare const make: (options?: {
    readonly entryTable?: string;
    readonly remotesTable?: string;
    readonly remoteCursorsTable?: string;
}) => Effect.Effect<EventJournal.EventJournal["Service"], SqlError.SqlError, SqlClient.SqlClient>;
/**
 * Provides a SQL-backed `EventJournal` from an existing `SqlClient` service.
 *
 * **Gotchas**
 *
 * Creating or migrating the schema requires a writable connection.
 *
 * @see {@link make} for constructing the SQL-backed service directly
 * @see {@link EventJournal.layerMemory} for an in-memory `EventJournal` layer
 * @see {@link EventJournal.layerIndexedDb} for an IndexedDB-backed `EventJournal` layer
 *
 * @stability unstable
 * @category layers
 * @since 4.0.0
 */
export declare const layer: (options?: {
    readonly entryTable?: string;
    readonly remotesTable?: string;
    readonly remoteCursorsTable?: string;
}) => Layer.Layer<EventJournal.EventJournal, SqlError.SqlError, SqlClient.SqlClient>;
//# sourceMappingURL=SqlEventJournal.d.ts.map