/**
 * Generic model identity matching — the ONE engine behind two different
 * questions the gateway asks about a model name:
 *
 *   1. **Request resolution** — "the caller typed `grok`; which model that
 *      they can actually use did they mean?" → `selectRequestModel`.
 *   2. **Metadata inheritance** — "this discovered model has no catalog
 *      card; whose authored metadata is the nearest fit?" →
 *      `selectMetadataDonor`.
 *
 * Both share parsing and identity comparison and DELIBERATELY do not share
 * a winner ordering: a request wants the NEWEST available model, while
 * inheritance wants the nearest known PREDECESSOR. Donor availability is
 * irrelevant — a disconnected provider's authored card still describes the
 * model.
 *
 * This module is pure and provider-agnostic. It holds no provider slug, no
 * family name, no model policy table, and it never fetches, reads a
 * catalog, touches a DB, or triggers auth/discovery. Every naming exception
 * (which `/`-prefixes are routing namespaces, which words are meaningful
 * variants, which families use hyphen versions or were renamed) arrives as
 * DATA in `TModelIdentityRules`, authored next to the model definitions
 * that need it.
 *
 * What it will NOT guess: a release version is a dotted numeric token
 * (`4.7`, `4.10`) or a catalog-declared hyphen version (`opus-4-8`).
 * Dates, context windows, parameter counts and quantization suffixes are
 * never versions — a wrong guess there silently reroutes traffic, so an
 * unknown version stays null and the caller keeps its existing behaviour.
 */

/** A release version as integers, most significant first. */
export type TModelVersion = ReadonlyArray<number>;

/**
 * Everything provider-specific the engine is allowed to know — and all
 * of it is DERIVED from a model corpus by {@link deriveModelIdentityRules},
 * never authored. There is no rule table to maintain: adding a model row
 * is the only thing anyone has to do.
 */
export type TModelIdentityRules = {
  /**
   * The ONLY prefixes that may be split off before a `/`. A custom
   * upstream id can legitimately contain slashes, so anything unlisted
   * keeps its id whole.
   */
  readonly namespaces?: ReadonlyArray<string>;
  /**
   * Words the corpus shows AFTER a version span (`sol`, `mini`,
   * `flash`). A token outside this set is family text, which is what
   * keeps a truncated shorthand like `5.6-s` from being read as a
   * request for a variant called `s`.
   */
  readonly variantTokens?: ReadonlyArray<string>;
  /**
   * Word-stems the corpus has shown carrying a generation number
   * (`kimi-k2.5`/`kimi-k3` → `k`).
   *
   * It exists because `k3` and `q4` are the SAME shape: a word welded to
   * a number. One is a generation, the other is quantization, and no
   * amount of structure separates them — only the observation that the
   * catalog shows `k` varying across several numbers while `q` does not.
   * Absent evidence the engine declines to guess, which is why a bare
   * parse leaves `kimi-k3` versionless rather than inventing a version.
   */
  readonly versionStems?: ReadonlyArray<string>;
};

/**
 * A parsed identity. `raw` and `providerModelId` keep their original
 * spelling because they are the EXECUTION identity; only the comparable
 * fields (`family`, `variants`) are case-normalised.
 */
export type TModelIdentity = {
  readonly raw: string;
  /** Set only when a recognised namespace prefixed the id. */
  readonly provider: string | null;
  readonly providerModelId: string;
  readonly family: string;
  readonly version: TModelVersion | null;
  readonly versionText: string | null;
  /** A date-like suffix. Kept apart from the version on purpose. */
  readonly snapshot: string | null;
  /** Sorted and de-duped so two identities compare by value. */
  readonly variants: ReadonlyArray<string>;
};

type TCompiledRules = {
  readonly namespaces: ReadonlySet<string>;
  readonly variantTokens: ReadonlySet<string>;
  readonly versionStems: ReadonlySet<string>;
};

const EMPTY_COMPILED: TCompiledRules = {
  namespaces: new Set<string>(),
  variantTokens: new Set<string>(),
  versionStems: new Set<string>(),
};

/**
 * Patterns are compiled ONCE per rules object and cached against it, so a
 * catalog index built from one rules value never recompiles per row.
 */
const compiledCache = new WeakMap<TModelIdentityRules, TCompiledRules>();

const compileRules = (
  rules: TModelIdentityRules | undefined,
): TCompiledRules => {
  if (rules === undefined) return EMPTY_COMPILED;
  const cached = compiledCache.get(rules);
  if (cached !== undefined) return cached;

  const compiled: TCompiledRules = {
    namespaces: new Set(
      (rules.namespaces ?? []).map((value) => value.toLowerCase()),
    ),
    variantTokens: new Set(
      (rules.variantTokens ?? []).map((value) => value.toLowerCase()),
    ),
    versionStems: new Set(
      (rules.versionStems ?? []).map((value) => value.toLowerCase()),
    ),
  };
  compiledCache.set(rules, compiled);
  return compiled;
};

/**
 * Date-like suffixes, longest/most specific shape first. Stripped BEFORE
 * version parsing so a dotted date can never be read as `1.2.3`.
 */
const SNAPSHOT_PATTERNS: ReadonlyArray<RegExp> = [
  /[-_@](\d{4}-\d{2}-\d{2})$/,
  /[-_@](\d{4}\.\d{2}\.\d{2})$/,
  /[-_@](\d{8})$/,
  // A ZERO-PADDED build number — Google's `-001` / `-002`, OpenAI's
  // `-0125`. Listed last so a date always wins.
  //
  // The leading zero is the whole discriminator, and it is why this is
  // not simply "three or four digits". A release number is written the
  // way the vendor says it (`4`, `4.0`, `4-8`, and one day `999` or
  // `1000`) and is never padded to a fixed width, so a padded run can
  // only be a build id, while an unpadded one is left alone to be read
  // as the version or family text it is. `imagen-4.0-generate-001`
  // therefore keeps `[4, 0]` as its version and carries `001` as its
  // snapshot, which is what makes the `-002` rebuild the SAME model
  // rather than a family of its own.
  /[-_@](0\d{2,3})$/,
];

/**
 * Tokenisation keeps `.` INSIDE a token so a dotted version survives as
 * one unit (`grok-4.7` → `grok` + `4.7`). Everything else separates.
 */
const TOKEN_SPLIT = /[-/_\s:]+/;

/** A whole token that is nothing but a dotted number: `4.7`, `4.10.1`. */
const DOTTED_VERSION = /^(\d+(?:\.\d+)+)$/;
/** A dotted number glued to a leading word: `qwen3.6`. */
const SUFFIXED_DOTTED_VERSION = /^(.*?)(\d+(?:\.\d+)+)$/;
/** A whole token that is a bare integer: the `4` and `8` of `opus-4-8`. */
const INTEGER_TOKEN = /^\d+$/;
/**
 * A word with a generation number welded onto it: `k3`, `qwen3`, `o4`.
 *
 * The letter/digit ORDER is the whole discriminator, and it is what
 * separates a version from a size. Letters-then-digits is a generation
 * (`k3`); digits-then-letters is a measurement — parameter counts
 * (`8b`, `32b`), context windows (`16k`, `128k`), quantization, and
 * `4o`-style suffixes — and never matches here.
 */
const ATTACHED_VERSION = /^([A-Za-z]+)(\d+)$/;

type TVersionSpan = {
  readonly stem: ReadonlyArray<string>;
  readonly version: TModelVersion;
  readonly versionText: string;
  readonly rest: ReadonlyArray<string>;
};

/**
 * Locate the release version STRUCTURALLY, with no vocabulary at all.
 *
 * Two shapes, in order:
 *   1. a dotted number, alone (`4.7`) or glued to a word (`qwen3.6`);
 *   2. otherwise, a run of bare integers that FOLLOWS a word — this is
 *      what makes `opus-4-8` and `fable-5` versions of one family
 *      without anyone authoring a regex for either.
 *
 * What it refuses is as important as what it accepts. The run must be
 * preceded by a word, so an id that is only digits has no version.
 * Snapshots are stripped before this runs, so a date can never reach it.
 * Sizes, context windows and quantization (`8b`, `128k`, `1.5b`) carry a
 * letter and therefore match neither shape. That is the whole
 * no-speculative-parsing rule, expressed as structure rather than as a
 * list somebody has to maintain.
 */
const findVersionSpan = (
  tokens: ReadonlyArray<string>,
  versionStems: ReadonlySet<string>,
): TVersionSpan | null => {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    const dotted = token.match(DOTTED_VERSION);
    if (dotted?.[1] !== undefined) {
      return {
        stem: tokens.slice(0, i),
        version: toVersionTuple(dotted[1]) ?? [],
        versionText: dotted[1],
        rest: tokens.slice(i + 1),
      };
    }
    const suffixed = token.match(SUFFIXED_DOTTED_VERSION);
    if (suffixed?.[2] !== undefined && suffixed[1] !== undefined) {
      const head = suffixed[1];
      return {
        stem:
          head.length > 0 ? [...tokens.slice(0, i), head] : tokens.slice(0, i),
        version: toVersionTuple(suffixed[2]) ?? [],
        versionText: suffixed[2],
        rest: tokens.slice(i + 1),
      };
    }
    const attached = token.match(ATTACHED_VERSION);
    if (
      attached?.[1] !== undefined &&
      attached[2] !== undefined &&
      versionStems.has(attached[1].toLowerCase())
    ) {
      return {
        stem: [...tokens.slice(0, i), attached[1]],
        version: [Number.parseInt(attached[2], 10)],
        versionText: attached[2],
        rest: tokens.slice(i + 1),
      };
    }
  }

  for (let i = 1; i < tokens.length; i += 1) {
    if (!INTEGER_TOKEN.test(tokens[i] as string)) continue;
    let end = i;
    while (
      end + 1 < tokens.length &&
      INTEGER_TOKEN.test(tokens[end + 1] as string)
    )
      end += 1;
    const run = tokens.slice(i, end + 1);
    return {
      stem: tokens.slice(0, i),
      version: run.map((part) => Number.parseInt(part, 10)),
      versionText: run.join("-"),
      rest: tokens.slice(end + 1),
    };
  }
  return null;
};

const toVersionTuple = (text: string): TModelVersion | null => {
  const parts = text
    .split(/[-.]/)
    .filter((part) => part.length > 0)
    .map((part) => Number.parseInt(part, 10));
  if (parts.length === 0 || parts.some((part) => Number.isNaN(part)))
    return null;
  return parts;
};

const splitNamespace = (
  raw: string,
  namespaces: ReadonlySet<string>,
): { readonly provider: string | null; readonly providerModelId: string } => {
  const slash = raw.indexOf("/");
  if (slash <= 0) return { provider: null, providerModelId: raw };
  const head = raw.slice(0, slash);
  if (!namespaces.has(head.toLowerCase()))
    return { provider: null, providerModelId: raw };
  return { provider: head, providerModelId: raw.slice(slash + 1) };
};

const uniqueSorted = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values)].sort();

/** The id with any date-like suffix removed, plus the suffix itself. */
const splitSnapshot = (
  value: string,
): { readonly remainder: string; readonly snapshot: string | null } => {
  for (const pattern of SNAPSHOT_PATTERNS) {
    const hit = value.match(pattern);
    if (hit?.[1] !== undefined && hit.index !== undefined)
      return { remainder: value.slice(0, hit.index), snapshot: hit[1] };
  }
  return { remainder: value, snapshot: null };
};

const stripSnapshot = (value: string): string => splitSnapshot(value).remainder;

const parseIdentity = (
  raw: string,
  compiled: TCompiledRules,
  splitNamespacePrefix: boolean,
): TModelIdentity => {
  const { provider, providerModelId } = splitNamespacePrefix
    ? splitNamespace(raw, compiled.namespaces)
    : { provider: null, providerModelId: raw };

  const { remainder, snapshot } = splitSnapshot(providerModelId);

  const allTokens = remainder
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .filter((token) => token.length > 0);

  // The version span is read structurally from the id itself.
  const span = findVersionSpan(allTokens, compiled.versionStems);
  const version: TModelVersion | null = span === null ? null : span.version;
  const versionText: string | null = span === null ? null : span.versionText;

  // Variant vocabulary stays a SET rather than "whatever followed the
  // version", because a query is parsed by the same code as a catalog
  // id: `5.6-s` is a truncated shorthand, not a request for a variant
  // called `s`. A token the corpus has never shown after a version is
  // therefore family text, and the boundary tier can still prefix-match
  // it. The set itself is derived, never authored — see
  // `deriveModelIdentityRules`.
  //
  // POSITION decides first, though. A variant MODIFIES a family, so it
  // can only appear after the version the family is a version OF: the
  // `tts` of `gemini-2.5-flash-preview-tts` is a modifier, while the
  // `tts` of `tts-1` IS the family. Classifying by vocabulary alone let
  // the second one evaporate into a variant, leaving an EMPTY family
  // that compared equal to every other empty one — which is how
  // `openai/tts-2` came to inherit another vendor's voices.
  const variants: string[] = [];
  let familyTokens: string[];
  if (span === null) {
    // No version means nothing to modify, so there is no variant to
    // read: the whole name is the identity. This is also what keeps a
    // versionless id and a versionless QUERY parsing alike, so the
    // shorthand `grok-code` still reaches `grok-code-1.2`.
    familyTokens = [...allTokens];
  } else {
    familyTokens = [...span.stem];
    for (const token of span.rest) {
      if (compiled.variantTokens.has(token)) variants.push(token);
      else familyTokens.push(token);
    }
  }

  return {
    raw,
    provider,
    providerModelId,
    family: familyTokens.join("-"),
    version,
    versionText,
    snapshot,
    variants: uniqueSorted(variants),
  };
};

/**
 * Parse a model id into its comparable parts. Pure and total — an
 * unparseable id simply yields a family with no version, which every
 * caller treats as "no confident match" rather than an error.
 *
 * A recognised routing namespace is split off, so this is the parser for
 * REQUEST input (`cursor/grok-4.7`). For an id that already arrived with
 * its provider alongside it, use `parseUpstreamModelIdentity`.
 */
export const parseModelIdentity = (
  raw: string,
  rules?: TModelIdentityRules,
): TModelIdentity => parseIdentity(raw, compileRules(rules), true);

/**
 * Parse an UPSTREAM model id whose provider is already known separately.
 *
 * No namespace is ever split off here: a custom endpoint may legitimately
 * serve `openai/gpt-5.6`, and that whole string is the id to send
 * upstream. Splitting it because `openai` happens to be a routing
 * namespace elsewhere would corrupt the execution identity of a model
 * belonging to a different provider.
 */
export const parseUpstreamModelIdentity = (
  providerModelId: string,
  rules?: TModelIdentityRules,
): TModelIdentity => parseIdentity(providerModelId, compileRules(rules), false);

/** One row of the corpus the rules are derived from. */
export type TModelCorpusEntry = {
  readonly provider: string;
  readonly providerModelId: string;
};

const derivedCache = new WeakMap<object, TModelIdentityRules>();

/**
 * Derive the identity rules from the model corpus ITSELF — the catalog
 * teaches the engine its own vocabulary, so adding a model row requires
 * no rule maintenance anywhere.
 *
 * Two things are derived, and nothing else:
 *
 *   - `namespaces`: the provider slugs the corpus actually contains, so
 *     `cursor/grok-4.7` splits while a custom endpoint's `org/model`
 *     stays whole.
 *   - `variantTokens`: every non-numeric token the corpus shows AFTER a
 *     version span (`gpt-5.6-sol` → `sol`, `sora-2-pro` → `pro`). That
 *     is what separates `gpt-5.4` from `gpt-5.4-mini` and keeps
 *     `gemini-3.5-flash` from donating to `gemini-3.1-pro`, with no list
 *     to maintain.
 *
 * Family and version structure is NOT derived: it is read structurally
 * per id (see `findVersionSpan`), so `claude-fable-5` and
 * `claude-fable-5-1` are one family at versions `[5]` and `[5,1]`
 * whether or not any sibling exists to compare them against.
 *
 * Memoised on the identity of the array passed in, so a catalog built
 * once yields ONE rules object for the process — which is what keeps the
 * per-object pattern cache, and any candidate index a caller keys off
 * it, from missing on every request.
 */
export const deriveModelIdentityRules = (
  models: ReadonlyArray<TModelCorpusEntry>,
): TModelIdentityRules => {
  const cached = derivedCache.get(models);
  if (cached !== undefined) return cached;

  const namespaces = new Set<string>();
  const variantTokens = new Set<string>();
  const tokenised: Array<ReadonlyArray<string>> = [];
  // Pass 1 — evidence. Which word-stems does this corpus actually show
  // carrying a generation number, and across how many DISTINCT numbers?
  // One sighting is not a series (`q4` alone is quantization); two or
  // more is (`k2.5`, `k2.6`, `k3`).
  const stemNumbers = new Map<string, Set<string>>();
  const note = (stem: string, numeric: string): void => {
    const key = stem.toLowerCase();
    const seen = stemNumbers.get(key);
    if (seen === undefined) stemNumbers.set(key, new Set([numeric]));
    else seen.add(numeric);
  };
  for (const model of models) {
    if (model.provider.length > 0) namespaces.add(model.provider.toLowerCase());
    const tokens = stripSnapshot(model.providerModelId.toLowerCase())
      .split(TOKEN_SPLIT)
      .filter((token) => token.length > 0);
    tokenised.push(tokens);
    for (const token of tokens) {
      const suffixed = token.match(SUFFIXED_DOTTED_VERSION);
      if (
        suffixed?.[1] !== undefined &&
        suffixed[2] !== undefined &&
        suffixed[1].length > 0
      ) {
        note(suffixed[1], suffixed[2]);
        continue;
      }
      const attached = token.match(ATTACHED_VERSION);
      if (attached?.[1] !== undefined && attached[2] !== undefined)
        note(attached[1], attached[2]);
    }
  }
  const versionStems = new Set(
    [...stemNumbers].filter(([, seen]) => seen.size > 1).map(([stem]) => stem),
  );

  // Pass 2 — the same evidence read from the OTHER spelling. A word the
  // corpus shows immediately before a separated version token is
  // carrying that release just as plainly as a welded one does
  // (`imagen-4.0-…`, `veo-3.1-…`), and here the number's role is not in
  // doubt — it was already read as a version — so one sighting is
  // enough. That is what lets a compressed `imagen5`/`veo4` land in its
  // own family instead of becoming a family nobody has ever seen.
  //
  // Collected into a SEPARATE set and merged only once the pass is over:
  // feeding a stem back into the set mid-loop would let a row parsed
  // early change how a later row parses, so the rules would depend on
  // the order the catalog happens to list its providers in.
  const precedingStems = new Set<string>();
  for (const tokens of tokenised) {
    const span = findVersionSpan(tokens, versionStems);
    const last = span?.stem[span.stem.length - 1];
    if (last !== undefined && /^[a-z]+$/.test(last)) precedingStems.add(last);
  }
  for (const stem of precedingStems) versionStems.add(stem);

  // Pass 3 — vocabulary. With the evidence in hand the spans are final,
  // so whatever trails one is a variant.
  for (const tokens of tokenised) {
    const span = findVersionSpan(tokens, versionStems);
    if (span === null) continue;
    for (const token of span.rest) {
      if (!INTEGER_TOKEN.test(token)) variantTokens.add(token);
    }
  }

  // Variant matching stays STRICT on purpose. An earlier pass derived
  // "family-inherent" variants — tokens every member of a family
  // happens to carry — and dropped them from the comparison, so that a
  // compressed `veo4` could reach `veo-3.1-generate-preview`. It is not
  // worth it: in a sparse corner of the catalog (one family with two
  // rows, or a subscription twin pair) a genuinely meaningful `flash` /
  // `mini` / `pro` is "always present" by accident, and erasing it
  // donates a specialised model's facts to a new BASE model. The real
  // successors — `imagen-5.0-generate-001`, `veo-4.0-generate-preview`
  // — carry the same post-version variants as their predecessors
  // anyway, so relaxing the version range already covers them.
  const derived: TModelIdentityRules = Object.freeze({
    namespaces: Object.freeze([...namespaces].sort()),
    variantTokens: Object.freeze([...variantTokens].sort()),
    versionStems: Object.freeze([...versionStems].sort()),
  });
  derivedCache.set(models, derived);
  return derived;
};

/**
 * Ascending numeric comparison. Shorter tuples are zero-padded (`4` ==
 * `4.0`) and an unknown version sorts lowest, so a versionless entry never
 * outranks a known release.
 */
export const compareModelVersion = (
  a: TModelVersion | null,
  b: TModelVersion | null,
): number => {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
};

/**
 * Same comparable family.
 *
 * Families are derived from the ids themselves, so two spellings of one
 * family already agree by construction and there is nothing left for a
 * rename table to reconcile.
 */
export const isComparableFamily = (
  a: TModelIdentity,
  b: TModelIdentity,
): boolean => a.family.length > 0 && a.family === b.family;

/** Identical meaningful variants — never a cross-variant match. */
export const isSameVariant = (a: TModelIdentity, b: TModelIdentity): boolean =>
  a.variants.length === b.variants.length &&
  a.variants.every((variant, index) => variant === b.variants[index]);

/** One eligible row, already carrying its parsed identity. */
export type TModelCandidate<TValue> = {
  /** Full routing id — the final, totally-ordered tie-break. */
  readonly id: string;
  readonly provider: string;
  readonly identity: TModelIdentity;
  /** The caller's entry, returned untouched. */
  readonly value: TValue;
  /** Preferred class; LOWER wins (e.g. subscription 0, metered 1). */
  readonly classRank?: number;
  /** Authored provider priority within a class; lower wins. */
  readonly providerRank?: number;
};

export type TModelCandidateInput<TValue> = {
  readonly id: string;
  readonly provider: string;
  readonly providerModelId: string;
  readonly value: TValue;
  readonly classRank?: number;
  readonly providerRank?: number;
};

export const buildModelCandidate = <TValue>(
  input: TModelCandidateInput<TValue>,
  rules?: TModelIdentityRules,
): TModelCandidate<TValue> => ({
  id: input.id,
  provider: input.provider,
  identity: parseUpstreamModelIdentity(input.providerModelId, rules),
  value: input.value,
  ...(input.classRank === undefined ? {} : { classRank: input.classRank }),
  ...(input.providerRank === undefined
    ? {}
    : { providerRank: input.providerRank }),
});

/** Build a whole index at once; rule patterns compile once for the batch. */
export const buildModelCandidates = <TValue>(
  inputs: ReadonlyArray<TModelCandidateInput<TValue>>,
  rules?: TModelIdentityRules,
): ReadonlyArray<TModelCandidate<TValue>> =>
  inputs.map((input) => buildModelCandidate(input, rules));

export type TModelMatchReason =
  | "exact_id"
  | "exact_provider_model_id"
  | "terminal_suffix"
  | "family_version"
  | "family_newest"
  | "prefix"
  | "boundary";

export type TModelSelection<TValue> =
  | {
      readonly kind: "selected";
      readonly candidate: TModelCandidate<TValue>;
      readonly reason: TModelMatchReason;
      /** Every candidate that survived narrowing, best first. */
      readonly considered: ReadonlyArray<TModelCandidate<TValue>>;
    }
  | {
      readonly kind: "ambiguous";
      readonly reason: TModelMatchReason;
      readonly candidates: ReadonlyArray<TModelCandidate<TValue>>;
    }
  | { readonly kind: "none" };

export type TSelectRequestModelOptions<TValue> = {
  readonly rules?: TModelIdentityRules;
  /**
   * Eligibility runs BEFORE any narrowing, which is the whole point: an
   * unavailable newest version must not eliminate an available older one.
   */
  readonly isEligible?: (candidate: TModelCandidate<TValue>) => boolean;
};

const MAX_RANK = Number.MAX_SAFE_INTEGER;

const compareStrings = (a: string, b: string): number =>
  a === b ? 0 : a < b ? -1 : 1;

/**
 * Snapshot precedence at an equal version, as a TOTAL order.
 *
 * Two rules, both unconditional, because a comparator that only
 * sometimes consults a key can produce a cycle (A beats B on snapshot,
 * B beats C on provider, C beats A on snapshot):
 *
 *   1. A STABLE ALIAS outranks any pinned build. The alias is the id
 *      the vendor keeps pointing at its current build, so it is what a
 *      family shorthand means; this also preserves the pre-existing
 *      behaviour for every family that has one.
 *   2. Between two builds the NEWER wins — `-002` over `-001`, the
 *      later date over the earlier — instead of whichever id happened
 *      to sort first alphabetically.
 *
 * Builds are compared by their digits as a number, so dates and short
 * build ids each order correctly among themselves and the mixed case
 * (which no real family produces) is still deterministic.
 */
const snapshotOrdinal = (snapshot: string | null): number =>
  snapshot === null
    ? Number.NEGATIVE_INFINITY
    : Number(snapshot.replace(/\D/g, ""));

const compareSnapshots = (a: TModelIdentity, b: TModelIdentity): number => {
  const aliasA = a.snapshot === null;
  const aliasB = b.snapshot === null;
  if (aliasA !== aliasB) return aliasA ? -1 : 1;
  if (aliasA) return 0;
  const left = snapshotOrdinal(a.snapshot);
  const right = snapshotOrdinal(b.snapshot);
  if (left !== right && Number.isFinite(left) && Number.isFinite(right))
    return left < right ? 1 : -1;
  return compareStrings(a.snapshot ?? "", b.snapshot ?? "");
};

/**
 * Total order for EQUIVALENT request candidates, best first: newest
 * version, then preferred class, then authored provider rank, then
 * snapshot precedence, then provider slug, then full id. Version leads
 * deliberately — an older subscription model must not beat a newer
 * available one on provider preference alone — and snapshot precedence
 * sits ahead of the provider/id tie so a rebuild is chosen for being
 * newer rather than for sorting later.
 *
 * Every component is a total order on a key and they are composed
 * lexicographically, so the result is total, transitive and free of
 * cycles regardless of which fields the candidates happen to carry.
 */
export const compareRequestCandidates = <TValue>(
  a: TModelCandidate<TValue>,
  b: TModelCandidate<TValue>,
): number => {
  const byVersion = compareModelVersion(b.identity.version, a.identity.version);
  if (byVersion !== 0) return byVersion;
  const byClass = (a.classRank ?? MAX_RANK) - (b.classRank ?? MAX_RANK);
  if (byClass !== 0) return byClass;
  const byProviderRank =
    (a.providerRank ?? MAX_RANK) - (b.providerRank ?? MAX_RANK);
  if (byProviderRank !== 0) return byProviderRank;
  const bySnapshot = compareSnapshots(a.identity, b.identity);
  if (bySnapshot !== 0) return bySnapshot;
  const byProvider = compareStrings(
    a.provider.toLowerCase(),
    b.provider.toLowerCase(),
  );
  if (byProvider !== 0) return byProvider;
  return compareStrings(a.id, b.id);
};

/** Escape a literal for embedding in a `RegExp` source. */
const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Hyphen-boundary matcher, preserving the existing shorthand rules: a
 * single word must be a WHOLE token (so `sol` misses `solstice`), while a
 * multi-segment shorthand may prefix-match after a boundary (`5.6-s` hits
 * `gpt-5.6-sol`).
 *
 * Compiled ONCE per query — the segment count is read from the text as the
 * caller typed it, which is why this cannot be derived from the parsed
 * family: parsing lifts the version out, and `5.6-s` would collapse to the
 * single token `s` and silently become a whole-token match.
 */
const compileBoundaryMatcher = (query: string): RegExp | null => {
  if (query.length === 0) return null;
  const escaped = escapeRegExp(query);
  const multiSegment = query.split("-").filter((s) => s.length > 0).length > 1;
  return new RegExp(
    multiSegment ? `(?:^|-)${escaped}` : `(?:^|-)${escaped}(?:$|-)`,
  );
};

const isVersionPrefix = (
  constraint: TModelVersion,
  candidate: TModelVersion | null,
): boolean =>
  candidate !== null &&
  constraint.length <= candidate.length &&
  constraint.every((part, index) => candidate[index] === part);

const hasAllVariants = (
  query: TModelIdentity,
  candidate: TModelIdentity,
): boolean =>
  query.variants.every((variant) => candidate.variants.includes(variant));

/**
 * Split candidates into comparable-family groups. More than one group means
 * the input spans unrelated families (`pro`, `mini`) and must stay
 * ambiguous rather than picking an unrelated model.
 */
const groupByFamily = <TValue>(
  candidates: ReadonlyArray<TModelCandidate<TValue>>,
): ReadonlyArray<ReadonlyArray<TModelCandidate<TValue>>> => {
  const groups: Array<Array<TModelCandidate<TValue>>> = [];
  for (const candidate of candidates) {
    const group = groups.find((existing) => {
      const head = existing[0];
      return (
        head !== undefined &&
        isComparableFamily(head.identity, candidate.identity)
      );
    });
    if (group === undefined) groups.push([candidate]);
    else group.push(candidate);
  }
  return groups;
};

const variantKey = (identity: TModelIdentity): string =>
  identity.variants.join("\u0000");

/**
 * True when the NEWEST generation among `ordered` offers more than one
 * distinct variant set. Used only for tiers where the query names fewer
 * variants than the candidates carry (`gpt-5.6` vs `gpt-5.6-luna` /
 * `-sol` / `-terra`): the caller did not say which sibling, so picking
 * one by slug order would be a guess. Rows sharing a variant set across
 * providers are ONE choice (provider preference still decides between
 * them), and an older generation's extra variants never cause ambiguity.
 */
const hasCompetingVariantsAtNewest = <TValue>(
  ordered: ReadonlyArray<TModelCandidate<TValue>>,
): boolean => {
  const best = ordered[0];
  if (best === undefined) return false;
  const keys = new Set<string>();
  for (const c of ordered) {
    if (compareModelVersion(c.identity.version, best.identity.version) !== 0)
      continue;
    keys.add(variantKey(c.identity));
    if (keys.size > 1) return true;
  }
  return false;
};

const decide = <TValue>(
  matches: ReadonlyArray<TModelCandidate<TValue>>,
  reason: TModelMatchReason,
  variantOpen = false,
): TModelSelection<TValue> => {
  const ordered = [...matches].sort(compareRequestCandidates);
  const best = ordered[0];
  if (best === undefined) return { kind: "none" };
  if (groupByFamily(ordered).length > 1)
    return { kind: "ambiguous", reason, candidates: ordered };
  if (variantOpen && hasCompetingVariantsAtNewest(ordered))
    return { kind: "ambiguous", reason, candidates: ordered };
  return { kind: "selected", candidate: best, reason, considered: ordered };
};

/**
 * Resolve a possibly-imprecise request model against already-scoped
 * candidates.
 *
 * Stages, in order: eligibility → exact identity → intent narrowing →
 * newest within the family → deterministic tie-break. Explicit input is
 * never upgraded: an exact `grok-4.6` stays on 4.6 even when 4.7 is
 * available, and a version fragment (`grok-4.6`) only ever selects a
 * maximum WITHIN that fragment.
 *
 * Nothing here decides availability, auth, or surface support — the caller
 * expresses all of that through `isEligible`, and a `none`/`ambiguous`
 * result means the caller keeps its existing passthrough/error behaviour.
 */
export const selectRequestModel = <TValue>(
  query: string,
  candidates: ReadonlyArray<TModelCandidate<TValue>>,
  options: TSelectRequestModelOptions<TValue> = {},
): TModelSelection<TValue> => {
  const rules = options.rules;
  const trimmed = query.trim();
  if (trimmed.length === 0) return { kind: "none" };

  const eligible =
    options.isEligible === undefined
      ? candidates
      : candidates.filter(options.isEligible);
  if (eligible.length === 0) return { kind: "none" };

  const lowered = trimmed.toLowerCase();

  const exactId = eligible.filter((c) => c.id.toLowerCase() === lowered);
  if (exactId.length > 0) return decide(exactId, "exact_id");

  const exactProviderModelId = eligible.filter(
    (c) => c.identity.providerModelId.toLowerCase() === lowered,
  );
  if (exactProviderModelId.length > 0)
    return decide(exactProviderModelId, "exact_provider_model_id");

  const intent = parseModelIdentity(trimmed, rules);

  let pool = eligible;
  if (intent.provider !== null) {
    const wanted = intent.provider.toLowerCase();
    pool = pool.filter((c) => c.provider.toLowerCase() === wanted);
  }
  if (intent.version !== null) {
    pool = pool.filter((c) =>
      isVersionPrefix(intent.version as TModelVersion, c.identity.version),
    );
  }
  if (intent.snapshot !== null) {
    pool = pool.filter((c) => c.identity.snapshot === intent.snapshot);
  }
  if (pool.length === 0) return { kind: "none" };

  // A family-less query (pure variant words such as `pro`) matches any
  // family; the group check below is what keeps it honest.
  const familyExact = (c: TModelCandidate<TValue>): boolean =>
    intent.family.length === 0 || isComparableFamily(intent, c.identity);
  // Both matchers compile once per query, never per candidate row. The
  // second one matches the id as TYPED against the upstream id, which is
  // what keeps version-carrying shorthand (`5.6-s` → `gpt-5.6-sol`)
  // working: the family alone has already lost the `5.6`.
  const familyMatcher = compileBoundaryMatcher(intent.family);
  const upstreamMatcher = compileBoundaryMatcher(
    intent.providerModelId.toLowerCase(),
  );
  const familyBoundary = (c: TModelCandidate<TValue>): boolean =>
    (familyMatcher?.test(c.identity.family) ?? false) ||
    (upstreamMatcher?.test(c.identity.providerModelId.toLowerCase()) ?? false);

  const versionReason: TModelMatchReason =
    intent.version === null ? "family_newest" : "family_version";

  // Narrowing tiers, strongest first. The first non-empty tier decides, so
  // an exact-family plain model always beats a boundary or variant sibling.
  // Evaluated LAZILY: the overwhelmingly common exact-family hit never
  // scans the pool three more times.
  // An id that ENDS with the query on a token boundary is a named model,
  // not a family shorthand: `fable-5` means `claude-fable-5` and must not
  // drift onto the later `claude-fable-5-1`. It therefore outranks the
  // newest-in-family tiers, while still obeying the eligibility, provider
  // and variant constraints applied above.
  const terminalSuffix = `-${intent.providerModelId.toLowerCase()}`;

  const tiers: ReadonlyArray<{
    readonly matches: (c: TModelCandidate<TValue>) => boolean;
    readonly reason: TModelMatchReason;
    /** Query leaves some candidate variants unspecified. */
    readonly variantOpen?: boolean;
  }> = [
    {
      matches: (c) =>
        c.identity.providerModelId.toLowerCase().endsWith(terminalSuffix) &&
        hasAllVariants(intent, c.identity),
      reason: "terminal_suffix",
      variantOpen: true,
    },
    {
      matches: (c) => familyExact(c) && isSameVariant(intent, c.identity),
      reason: versionReason,
    },
    {
      matches: (c) => familyExact(c) && hasAllVariants(intent, c.identity),
      reason: versionReason,
      variantOpen: true,
    },
    {
      matches: (c) => familyBoundary(c) && isSameVariant(intent, c.identity),
      reason: "boundary",
    },
    {
      matches: (c) => familyBoundary(c) && hasAllVariants(intent, c.identity),
      reason: "prefix",
      variantOpen: true,
    },
  ];

  for (const tier of tiers) {
    const matches = pool.filter(tier.matches);
    if (matches.length === 0) continue;
    return decide(matches, tier.reason, tier.variantOpen === true);
  }
  return { kind: "none" };
};

export type TDonorRelation =
  | "exact"
  | "same_provider_predecessor"
  | "cross_provider_predecessor";

export type TDonorSelection<TValue> =
  | {
      readonly kind: "donor";
      readonly donor: TModelCandidate<TValue>;
      readonly relation: TDonorRelation;
    }
  | { readonly kind: "none" };

export type TSelectMetadataDonorOptions<TValue> = {
  readonly rules?: TModelIdentityRules;
  /** Exclude deprecated/synthesized rows — the caller owns that fact. */
  readonly isEligibleDonor?: (candidate: TModelCandidate<TValue>) => boolean;
};

/**
 * Pick the nearest authored donor for a target identity.
 *
 * Classes, strongest first: an exact id, then the greatest same-provider
 * version NOT EXCEEDING the target, then the same across providers. A
 * successor is never a donor — borrowing from a version that does not
 * exist yet would present a guess as a fact — and an unrelated family
 * yields `none` so the caller keeps its existing unknown-metadata
 * behaviour rather than inheriting from a nearest string.
 *
 * The engine returns a donor and a RELATION only. Which fields may be
 * inherited, and which (identity, lifecycle, routing policy, repair flags)
 * may never be, is the catalog's policy, not this module's.
 */
export const selectMetadataDonor = <TValue>(
  target: TModelIdentity,
  donors: ReadonlyArray<TModelCandidate<TValue>>,
  options: TSelectMetadataDonorOptions<TValue> = {},
): TDonorSelection<TValue> => {
  const pool =
    options.isEligibleDonor === undefined
      ? donors
      : donors.filter(options.isEligibleDonor);
  if (pool.length === 0) return { kind: "none" };

  const targetProvider = target.provider?.toLowerCase() ?? null;
  const isSameProvider = (candidate: TModelCandidate<TValue>): boolean =>
    targetProvider !== null &&
    candidate.provider.toLowerCase() === targetProvider;

  const best = (
    matches: ReadonlyArray<TModelCandidate<TValue>>,
  ): TModelCandidate<TValue> | undefined =>
    [...matches].sort(compareRequestCandidates)[0];

  const lowered = target.providerModelId.toLowerCase();
  const exact = pool.filter(
    (c) => c.identity.providerModelId.toLowerCase() === lowered,
  );
  if (exact.length > 0) {
    const sameProvider = exact.filter(isSameProvider);
    const donor = best(sameProvider.length > 0 ? sameProvider : exact);
    if (donor !== undefined) return { kind: "donor", donor, relation: "exact" };
  }

  // A donor must not be a SUCCESSOR: borrowing from a version that does
  // not exist yet presents a guess as a fact. That is the only version
  // constraint.
  //
  // There was also a same-MAJOR gate here, on the theory that a major
  // bump is where a vendor changes the facts. In practice it fenced off
  // almost every media line the catalog actually has — `gpt-image-3`,
  // `whisper-2`, `text-embedding-4-small`, the next Imagen and Veo —
  // because those families number their generations in the major
  // position, so EVERY successor was a major bump and inherited
  // nothing. The gate is removed deliberately: what a donor may
  // contribute is already constrained by category (identity, lifecycle,
  // routing, repair flags and rates never cross; a cross-provider donor
  // additionally contributes no provider-serving fact), everything it
  // does contribute fills only fields the target left UNKNOWN, and the
  // result is reported as inherited. A nearest known predecessor is
  // better information than nothing, and the ordering below still
  // prefers the closest one — so a same-major predecessor, when one
  // exists, is the one chosen.
  const withinInheritableRange = (donor: TModelIdentity): boolean => {
    if (target.version === null || donor.version === null) return true;
    return compareModelVersion(donor.version, target.version) <= 0;
  };

  const predecessors = pool.filter(
    (c) =>
      isComparableFamily(target, c.identity) &&
      isSameVariant(target, c.identity) &&
      withinInheritableRange(c.identity),
  );
  if (predecessors.length === 0) return { kind: "none" };

  const sameProvider = predecessors.filter(isSameProvider);
  const sameProviderDonor = best(sameProvider);
  if (sameProviderDonor !== undefined)
    return {
      kind: "donor",
      donor: sameProviderDonor,
      relation: "same_provider_predecessor",
    };

  const crossProviderDonor = best(predecessors);
  if (crossProviderDonor === undefined) return { kind: "none" };
  return {
    kind: "donor",
    donor: crossProviderDonor,
    relation: "cross_provider_predecessor",
  };
};
