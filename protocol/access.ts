import { Effect, Schema as S } from "effect";

export const ModelEntry = S.String;
export type TModelEntry = S.Schema.Type<typeof ModelEntry>;
export const ModelAccess = S.Struct({
  allow: S.Array(ModelEntry).pipe(
    S.withDecodingDefault(Effect.succeed([] as ReadonlyArray<string>)),
  ),
  deny: S.Array(ModelEntry).pipe(
    S.withDecodingDefault(Effect.succeed([] as ReadonlyArray<string>)),
  ),
});
export type TModelAccess = {
  readonly allow: ReadonlyArray<string>;
  readonly deny: ReadonlyArray<string>;
};
export const RouteKind = S.Literals([
  "subscription",
  "local",
  "team",
  "byok",
  "included",
]);
export type TRouteKind = S.Schema.Type<typeof RouteKind>;
export const TEAM_PERMISSIONS = [
  "team.invite",
  "team.delete",
  "team.role",
  "member.manage",
  "share.contribute",
  "inference.use",
] as const;
export const Permission = S.Literals([
  ...TEAM_PERMISSIONS,
  "media.read",
  "media.write",
  "sessions.read",
  "sessions.write",
  "mcp.use",
  "memory.read",
  "memory.write",
  "keys.manage",
  "credentials.manage",
  "config.manage",
  "stats.read",
  "marketplace.manage",
  "daemon.use",
  "billing.manage",
  "account.manage",
]);
export type TPermission = S.Schema.Type<typeof Permission>;
/** The highest requests-a-minute limit a key can be given. */
export const MAX_RPM = 10_000;
/** Requests a minute a new app connection may make until its owner changes it. */
export const CONNECTOR_DEFAULT_RPM = 60;
export const Caps = S.Struct({
  total: S.NullOr(S.Number).pipe(
    S.withDecodingDefault(Effect.succeed(null as number | null)),
  ),
  models: S.Record(ModelEntry, S.Number).pipe(
    S.withDecodingDefault(
      Effect.succeed({} as Readonly<Record<string, number>>),
    ),
  ),
  usd: S.NullOr(S.Number).pipe(
    S.check(
      S.makeFilter((value) =>
        value === null
          ? undefined
          : "USD caps are not supported until enforcement is implemented",
      ),
    ),
    S.withDecodingDefault(Effect.succeed(null as number | null)),
  ),
  /**
   * Requests a minute, counted per key. Absent or null means no limit. A
   * connector's grant starts at `CONNECTOR_DEFAULT_RPM`; its owner may lift it.
   */
  rpm: S.optionalKey(
    S.NullOr(
      S.Number.pipe(
        S.check(
          S.makeFilter((value) =>
            Number.isInteger(value) && value >= 1 && value <= MAX_RPM
              ? undefined
              : `rpm must be a whole number from 1 to ${MAX_RPM}`,
          ),
        ),
      ),
    ),
  ),
});
export type TCaps = {
  readonly total: number | null;
  readonly models: Readonly<Record<string, number>>;
  readonly usd: number | null;
  readonly rpm?: number | null;
};
const emptyModels: TModelAccess = { allow: [], deny: [] };
const emptyCaps: TCaps = { total: null, models: {}, usd: null };
export const AccessPolicy = S.Struct({
  models: ModelAccess.pipe(S.withDecodingDefault(Effect.succeed(emptyModels))),
  routes: S.NullOr(S.Array(RouteKind)).pipe(
    S.withDecodingDefault(
      Effect.succeed([] as ReadonlyArray<TRouteKind> | null),
    ),
  ),
  permissions: S.Array(Permission).pipe(
    S.withDecodingDefault(Effect.succeed([] as ReadonlyArray<TPermission>)),
  ),
  caps: Caps.pipe(S.withDecodingDefault(Effect.succeed(emptyCaps))),
  expires_at: S.NullOr(S.String).pipe(
    S.withDecodingDefault(Effect.succeed(null as string | null)),
  ),
});
export type TAccessPolicy = {
  readonly models: TModelAccess;
  readonly routes: ReadonlyArray<TRouteKind> | null;
  readonly permissions: ReadonlyArray<TPermission>;
  readonly caps: TCaps;
  readonly expires_at: string | null;
};
export const EMPTY_POLICY: TAccessPolicy = {
  models: emptyModels,
  routes: [],
  permissions: [],
  caps: emptyCaps,
  expires_at: null,
};
export const FULL_KEY_POLICY: TAccessPolicy = {
  models: { allow: ["*"], deny: [] },
  routes: null,
  permissions: Permission.literals.filter(
    (permission) =>
      permission === "inference.use" ||
      !(TEAM_PERMISSIONS as ReadonlyArray<string>).includes(permission),
  ),
  caps: emptyCaps,
  expires_at: null,
};
/** What a key needs to run AI: requests, plus the data its tools read and write. */
export const USE_PERMISSIONS = [
  "inference.use",
  "media.read",
  "media.write",
  "sessions.read",
  "sessions.write",
  "mcp.use",
  "memory.read",
  "memory.write",
  "daemon.use",
] as const satisfies ReadonlyArray<TPermission>;
/** Control over the account itself. Never in a new key's default. */
export const ACCOUNT_PERMISSIONS = [
  "keys.manage",
  "credentials.manage",
  "config.manage",
  "stats.read",
  "marketplace.manage",
  "billing.manage",
  "account.manage",
] as const satisfies ReadonlyArray<TPermission>;
/**
 * Every key minted from now on, device or not: it can run AI on any model and
 * route, and nothing else. Existing rows keep `FULL_KEY_POLICY` (the column
 * default) until their owner narrows them.
 */
export const NEW_KEY_POLICY: TAccessPolicy = {
  ...FULL_KEY_POLICY,
  permissions: USE_PERMISSIONS,
};
/**
 * The widest policy an OAuth connector may hold, and a client's default
 * ceiling: every model and route, the Use permissions except `daemon.use`.
 * Account control never reaches a connector.
 */
export const CONNECTOR_DEFAULT_POLICY: TAccessPolicy = {
  ...FULL_KEY_POLICY,
  permissions: USE_PERMISSIONS.filter(
    (permission) => permission !== "daemon.use",
  ),
};
export const FULL_SESSION: TAccessPolicy = {
  ...FULL_KEY_POLICY,
  permissions: Permission.literals,
};
