/**
 * Returns the current version of the `effect` package.
 *
 * **Details**
 *
 * Defaults to the release version unless overridden by `setCurrentVersion`.
 *
 * @stability unstable
 * @category getters
 * @since 4.0.2
 */
export declare const getCurrentVersion: () => string;
/**
 * Overrides the version returned by `getCurrentVersion`.
 *
 * **Gotchas**
 *
 * Applies to this copy of the module. Existing telemetry layers retain the
 * version they read when built.
 *
 * @stability unstable
 * @category setters
 * @since 4.0.2
 */
export declare const setCurrentVersion: (version: string) => void;
//# sourceMappingURL=Version.d.ts.map