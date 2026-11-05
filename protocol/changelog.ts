import { Schema as S } from "effect";

/**
 * Changelog entry: one change written for users. This is what gets published:
 * the page, the feed, the in-app list and the CLI's `whats_new` line all read
 * this shape. The monthly digest groups entries for push channels; it lives
 * in `@openllm/schema` because no client ever reads it.
 *
 * Only PUBLISHED entries cross this boundary, so there is no draft/published
 * status field: in the content store, being a draft is a property of the
 * document id, not of its data.
 *
 * Design: `docs/proposals/2026-09-29-changelog-flow-architecture.md`.
 */

/**
 * What kind of change an entry is. A closed list (the product version of Keep
 * a Changelog's categories). Adding a kind is a contract change: an older CLI
 * that decodes `whats_new` rejects a kind it doesn't know.
 */
export const CHANGELOG_KINDS = [
  "new",
  "improved",
  "fixed",
  "breaking",
  "deprecated",
  "removed",
  "security",
] as const;
export const ChangelogKind = S.Literals([...CHANGELOG_KINDS]);
export type TChangelogKind = S.Schema.Type<typeof ChangelogKind>;

/** Product areas an entry can be filtered by. Closed for the same reason. */
export const CHANGELOG_TAGS = [
  "gateway",
  "subscriptions",
  "cli",
  "app",
  "billing",
] as const;
export const ChangelogTag = S.Literals([...CHANGELOG_TAGS]);
export type TChangelogTag = S.Schema.Type<typeof ChangelogTag>;

/** Title limit: a short line starting with a verb. */
export const CHANGELOG_TITLE_MAX = 70;
/** Summary limit: one or two sentences on why the change matters. */
export const CHANGELOG_SUMMARY_MAX = 180;
/** Limit for a Breaking entry's `action` line. */
export const CHANGELOG_ACTION_MAX = 180;

/**
 * Editor-written text: one line, non-empty, at most `max` characters, and no
 * stray whitespace at either end. Every changelog field is shown on a single
 * line somewhere (the CLI's `whats_new`, an email subject, a card), so a line
 * break (including U+2028 / U+2029) or control character is always a mistake, and in a subject header
 * it is a hazard.
 */
export const changelogText = (max: number): S.String =>
  S.String.check(
    S.makeFilter((value: string) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value), {
      message: "must be a single line without control characters",
    }),
    S.makeFilter((value: string) => value.trim() === value, {
      message: "must not start or end with whitespace",
    }),
    S.isMinLength(1),
    S.isMaxLength(max),
  );

/** URL segment: lowercase words joined by single hyphens. */
export const ChangelogSlug = S.String.check(
  S.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  S.isMaxLength(96),
);

/**
 * A calendar date (`YYYY-MM-DD`) that is real, so `2026-02-30` fails. An
 * entry's date is the day the change reached users, not the day it was
 * written up, so it carries no time of day.
 */
export const ChangelogDate = S.String.check(
  S.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  S.makeFilter(
    (value: string) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    },
    { message: "must be a real calendar date" },
  ),
);

/** A stable release version, bare `x.y.z`: prereleases never become entries. */
export const ChangelogVersion = S.String.check(
  S.isPattern(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/),
);

/** The entry's one outbound link; https only. */
export const ChangelogHref = S.String.check(
  S.makeFilter(
    (value: string) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "must be an absolute https URL" },
  ),
);

const ChangelogEntryFields = S.Struct({
  slug: ChangelogSlug,
  title: changelogText(CHANGELOG_TITLE_MAX),
  summary: changelogText(CHANGELOG_SUMMARY_MAX),
  kind: ChangelogKind,
  tags: S.Array(ChangelogTag),
  /** The day the change reached users. Pages sort by this. */
  shipped_at: ChangelogDate,
  /**
   * The first stable release the change shipped in. Absent for announcements
   * that aren't code (pricing, partnerships).
   */
  version: S.optional(ChangelogVersion),
  href: S.optional(ChangelogHref),
  /** What the user must do. Required when `kind` is `breaking`. */
  action: S.optional(changelogText(CHANGELOG_ACTION_MAX)),
});

export const ChangelogEntry = ChangelogEntryFields.check(
  S.makeFilter(
    (
      entry: S.Schema.Type<typeof ChangelogEntryFields>,
    ):
      | boolean
      | {
          readonly path: ReadonlyArray<PropertyKey>;
          readonly issue: string;
        } => {
      if (entry.kind === "breaking" && entry.action === undefined) {
        return {
          path: ["action"],
          issue: "a breaking entry must say what the user has to do",
        };
      }
      if (new Set(entry.tags).size !== entry.tags.length) {
        return { path: ["tags"], issue: "tags must not repeat" };
      }
      return true;
    },
  ),
);
export type TChangelogEntry = S.Schema.Type<typeof ChangelogEntry>;
