<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="./assets/openllm-light.svg">
    <img alt="OpenLLM" src="./assets/openllm.svg" width="300">
  </picture>
</p>

<p align="center"><b>protocol</b> — the public protocol surface for OpenLLM.</p>

<p align="center">
  <a href="../LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <img alt="deps: effect only" src="https://img.shields.io/badge/deps-effect%20only-blue.svg">
</p>

---

The pure, dependency-light **type & wire contracts** every OpenLLM client
speaks — defined once as [Effect Schema](https://effect.website) (runtime
validators **and** inferred TypeScript types from a single source):

- chat completions · responses · streaming events
- provider request/response shapes · cost & model catalog
- request-status · daemon & relay control frames
- local-provider contracts (`local-provider.ts`) · URL locality helpers
  (`url-locality.ts`)

No HTTP, no provider implementations, no `fetch` — contracts and pure helpers.
(`isSafeRemoteEndpoint` lives in the Node-only `url-locality-dns` subpath, outside the index, because it imports `node:dns/promises` on hosted
runtimes; browser/edge keep the pure `isLocalEndpoint` classifier.) Build a
third-party OpenLLM client against this and nothing else.

## Install

```sh
bun install github:openllmsh/sdk#<tag>
```

```ts
import { ChatCompletionRequest } from "@openllmsh/sdk/protocol";
import { Schema } from "effect";

const req = Schema.decodeUnknownSync(ChatCompletionRequest)(body);
```

## Model identity matching

`model-match.ts` provides pure matching primitives shared by request resolution
and catalog metadata inheritance. `deriveModelIdentityRules` derives namespaces,
variant tokens, and attached-version evidence from existing catalog model IDs;
there are no provider-specific token lists or model-family regex tables to update.

- `buildModelCandidates` preserves raw upstream IDs while parsing comparable
  family/version structure.
- `selectRequestModel` filters eligibility before choosing the newest matching
  release, then applies caller-supplied provider preference and alphabetical ties.
  Exact IDs and named suffixes take precedence over shorthand.
- `selectMetadataDonor` chooses an exact identity or family/variant-compatible
  predecessor, preferring the target provider. Generation increments can inherit
  metadata too; media successors frequently increment a single integer rather
  than a minor version. Successor donors and empty-family matches are rejected.
  It returns a donor, not a merged model: field precedence and provenance belong
  to the consuming catalog layer.
- Numbered builds such as `-001` and `-002` remain snapshots rather than family
  names. At equal version/provider preference, stable aliases precede builds,
  then newer builds precede older ones; explicit pins are unchanged.

`plan-surface.ts` carries an explicit media request's surface to daemon plan
resolution. Missing surface retains chat semantics; general model-detail lookup
can resolve across surfaces without applying a chat-only filter.

The caller supplies catalog entries and availability; these utilities do not
fetch model lists, inspect credentials, or perform provider authentication.

## Local providers (oauth + local)

`local-provider.ts` is the daemon-only identity surface shared by cloud
routing, the daemon walker, and the `/providers` Local tab:

- `LocalProviderVariant` — `"oauth" | "local"`.
- `OAuthProviderSlug` — closed set of subscription-CLI slugs; historical
  `SubscriptionProviderSlug` remains a deprecated alias for one release.
- `LOCAL_SERVER_PRESETS` / `LocalServerPresetSlug` / `local_port_<n>` helpers
  (`isLocalServerSlug`, `localPortSlug`, …).
- `LocalKeyProviderSlug` / `LOCAL_KEY_PROVIDER_PRESETS` — the `local_key`
  variant: API-key-only subscription plans whose keys live on the device
  (`set_provider_key`, gated on `LOCAL_KEY_PROVIDERS_CONTROL_CAP`).
  `isAccountProviderSlug` = oauth ∪ local_key (routed by provider).
- `isLocalProvider` / `localProviderVariant` — "cloud never serves this hop"
  (oauth ∪ local_key ∪ local server). OAuth-specific sites keep narrowing to the oauth
  variant / `isOAuthProviderSlug`.
- Refusal codes: `subscription_requires_daemon` (historical oauth string) and
  `local_requires_daemon`.

**Wire compatibility.** `/v1/models` keeps `provider_type: "subscription"` for
oauth cards; local cards use `"local"`. Both may carry
`provider_variant: "oauth" | "local"`. `ModelProviderType` is
`"subscription" | "api_key" | "local"`. Daemon status/commands are additive:
optional `local_servers` on status, `local_entries` on model report, and
`local_rescan` / `set_local_key` command kinds — older daemons ignore them.

`url-locality.ts` classifies loopback/private URLs without DNS
(`isLocalEndpoint`) and, for hosted callers, resolves public names before
connect (`isSafeRemoteEndpoint`) so redirects cannot SSRF into non-public
space.

## Vendor CLI installation status

`DaemonProviderConnection.cli_install` is optional metadata for background vendor
installers started by OpenLLM's first-run installer. It is separate from
`cli_installed` (binary presence) and provider authentication. External installs
and older daemons have no progress record; absence must not be interpreted as an
active installation.

`VendorCliInstall` carries an attempt ID, `installing` / `awaiting_detection` /
`failed` / `interrupted` stage, timestamps, and an optional safe failure reason.
A successful installer exit still awaits binary detection. No percentages, raw
installer output, process IDs, credentials, or host paths belong in this wire
metadata. The cloud relays and persists it with the device's existing status.

`DaemonProviderConnection.host_signed_in` is an optional boolean hint that the
user is already signed in to the vendor's CLI in their own home on the daemon's
machine. The daemon derives it from a read-only presence check of the vendor's
host credential file and never copies or uses that credential; absence means
unknown (older daemon, keychain-backed store, unreadable file), not signed out.

## License

[Apache-2.0](../LICENSE) © OpenLLM, INC.

---

> **Read-only mirror.** Regenerated from the OpenLLM monorepo each release.
> Issues & PRs welcome — they're ingested upstream and your commit is
> preserved. Sign-off (DCO) on commits, please.
