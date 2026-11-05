# `packages/sdk/vault` Architecture

> Zero-knowledge crypto — pure bytes-in/bytes-out primitives that run
> identically in the browser and on the proxy. Depends on nothing
> app-specific. Provider credentials are client-encrypted at rest; the proxy
> decrypts them only transiently for an authenticated upstream request.

Referenced from the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

---

## Modules

```
vault/
  crypto.ts    — WebCrypto AES-256-GCM + HKDF-SHA256 + b64/b64url + zero()
  argon2.ts    — Argon2id wrap-key derivation, params registry keyed by version
  wrapped.ts   — sealed-blob layout: IV||ct, plus the `v<n>:` KDF stamp
  derive.ts    — buildVault / unlockDek (phrase → DEK via wrapped_dek)
  credential.ts— encrypt/decrypt a credential row under the DEK
  api-key.ts   — sk-llm parse + HKDF api-wrap-key + dek_for_key un/wrap + mint
  device-access.ts — Ed25519 SPKI encoding + device-grant sign / verify
  device-control.ts— the account device-control key (phrase → Ed25519, never
                 from the DEK), rotation sign/verify, control-keep outer key
  daemon-attest.ts — control-signed attestation of a daemon X25519 key (dpk)
  handoff.ts   — device handoff: X25519 seal of the DEK (+ phrase) to a new
                 device, its binding, the phrase check, the 6-digit code
  cli-auth-seal.ts — seal an ordinary sk-llm API key to a CLI caller's ephemeral
                 X25519 pubkey (CLI OpenLLM OAuth handover; distinct domain/AAD
                 from the connector seal so ciphertexts are not interchangeable)
  passkey.ts   — WebAuthn-PRF DEK wrap (HKDF, AAD-bound to credential + generation)
  phrase.ts · pin.ts (deriveVaultState lives in lib/vault/state.ts)
  team.ts    — user-held team key T: seal under DEK, invite wrap, K_mem, memory seal
  index.ts
```

## Zero-knowledge vault

Provider credentials are never persisted in plaintext or sent plaintext
when saved from the browser. The proxy receives plaintext only after it
transiently decrypts an authenticated request's credential. The crypto is
in `packages/sdk/vault` (browser- and proxy-compatible, pure bytes-in/bytes-out):

- A **recovery phrase** → `wrap_key` via **Argon2id** (`argon2.ts`,
  salt = `wrap_salt`). The Argon2id parameters are an **append-only
  registry keyed by version**, and every wrapped blob is stamped with the
  version that produced it (`wrapped.ts`, `v<n>:<base64>`). Editing a
  parameter in place would change every derived `wrap_key` and, with no
  server-side escape hatch, permanently lock out every existing vault —
  so re-tuning means adding a version, never changing one. An unstamped
  blob is v1.
- A random 32-byte **DEK** is AES-GCM-wrapped under `wrap_key` →
  `wrapped_dek`. Only `wrap_salt` + `wrapped_dek` are stored on
  `users`; the phrase and DEK never touch the DB in the clear (the
  phrase is stored only sealed under a passkey's PRF output, see
  "Passkey wraps" below).
- Credentials are AES-256-GCM encrypted under the DEK in the browser
  before `POST /api/credentials`; the row stores `{ ciphertext, nonce,
  vault_version }`.

**API keys carry the DEK, not a hash.** `mintApiKey` (client-side)
picks `(id, secret)`, derives `api_wrap_key = HKDF(secret, salt=id,
info="api-key-v1")`, wraps the DEK → `dek_for_key`, and also wraps the
full `sk-llm-{id}.{secret}` string under the DEK (`secret_ciphertext`)
so an unlocked dashboard can re-display it. At mint time the server
receives the public key id and metadata plus only wrapped secret material;
the token itself is sent in an authenticated request header. On each `/v1/*` request,
`validateApiKey` looks up the row by id, checks
`key.vault_version === user.vault_version`, re-derives `api_wrap_key`,
and AES-GCM-unwraps `dek_for_key` to recover the DEK — an auth-tag
failure (wrong secret) returns 401. The proxy decrypts the provider
credential with that DEK, then `zero()`s it in `finally`.

### Device-control key (seedgate trust root)

Device grants, daemon attestations and their rotations are signed by ONE
account **device-control key**, Ed25519, derived in the browser from the
recovery phrase:

```
entropy = BIP39 entropy(normalizePhrase(phrase))        // checksum-checked
seed    = HKDF-SHA256(entropy, salt="openllm-device-control-salt-v1",
                      info="openllm-device-control-v1", 32)
```

It is never derived from the DEK and never wrapped for an API key, because the
server unwraps the DEK from `dek_for_key` on every `sk-llm` request: a key the
DEK can produce is a key a compromised cloud can sign with. (The previous
per-key `HKDF(DEK, key_id)` seed was deleted for exactly that reason.) HKDF,
not Argon2id: the phrase already carries 128 bits, and HKDF keeps every
server-supplied input (`wrap_salt`, KDF version) out of the key. Callers derive
only from a phrase they have proven (`unlockDek`, an accepted handoff).

The server stores only public material: `users.device_control_pubkey`
(+ `device_control_version`, the signed `device_control_rotations` chain), each
provisioned `api_keys.device_access_pubkey` (= the control key; the column
name is historical), and `daemon_attestations` rows. Each signed message is
`label || 0x00 || json`:

- grant — `openllm-device-grant-v1` (`@openllmsh/sdk/tunnel` `device-grant.ts`);
- attestation — `openllm-daemon-attest-v1`, `{v, user_id, key_id, dpk, cv, ts}`
  (`daemon-attest.ts`): key_id-bound cache of a proof-verified daemon X25519
  key; any browser verifies it with its OWN derived key before using
  that `dpk` for grants, Noise and the RTC seal;
- rotation — `openllm-device-control-rotate-v2`, `{v:2, old, new, cv}`, signed
  by `old`, no timestamp (`@openllmsh/sdk/tunnel` `device-control.ts`): stored and
  replayed to daemons that were offline when the phrase rotated.

In a browser the seed lives at rest only under the same local unlock as the
DEK session — the "control keep" (`controlKeepOuterKey(dek, userId)` outside a
non-extractable per-browser IndexedDB key; `lib/vault/control-keep.ts`). A
passkey is only an alternative to the PIN for unlocking the vault DEK; it does
not wrap the control seed. Opening the DEK (PIN or passkey) restores the seed
from the control keep. The server cannot open the keep. Daemons pin the public
key from the install-time trust anchor, a signed rotation, or the desktop app
over loopback — never trust-on-first-use for agent sessions
(`packages/cli/daemon/src/device-access-verify.ts`).

`device-anchor.ts` is the browser half of that anchor: `buildDeviceAnchor` /
`buildAnchoredApiKey` (`base64url(control raw || HKDF(seed, utf8(key_id),
"openllm-pair-v1"))`, appended to the key in the command the user copies),
`verifyDpkProof` (the daemon's `HMAC(pair_secret, "openllm-dpk-proof-v1" ||
key_id || dpk)` — checked before any `dpk` is trusted), and
`signDeviceSessionsDisable` (the control-signed remote DISABLE only —
re-enable writes the anchor again via install / update / login / desktop).

## Vault state machine

`vault_state` (derived by `deriveVaultState` in `lib/vault/state.ts`) is one of
`uninitialized → pending_phrase → ready`, plus `reset_pending`. The
transitions are driven by the `/api/vault/*` handlers (see
[`packages/api`](../api/ARCHITECTURE.md)), operating on the vault columns
of `public.users`:

- `begin` (uninitialized→pending_phrase): stage `wrap_salt`.
- `commit` (pending_phrase→ready): save `wrapped_dek`, bump
  `vault_version` 0→1. TOCTOU-guarded (`WHERE wrapped_dek IS NULL`).
- `abandon` (pending_phrase→uninitialized): clear staging if the phrase
  was lost between steps.
- `reset/begin` (ready→reset_pending): stage `*_next` columns + optional
  re-encrypted credentials at `vault_version+1`, in one txn. Proxy keeps
  reading the current generation until commit. From `reset_pending` it
  REPLACES the stale staging (dropping that staging's `vault_version+1`
  credentials): a staged phrase only lives in the dialog that made it, so a
  staging found later is one nobody can finish.
- `reset/commit`: optionally names the staging it means
  (`staged_wrapped_dek`); a mismatch — another tab's `begin` replaced it —
  is a 409 `reset_conflict` that promotes nothing. Otherwise: promote `*_next`, drop old-generation credentials,
  bump `vault_version`, **hard-delete all API keys** (their
  `dek_for_key` wraps the now-stale DEK), and **hard-delete all saved
  memories** (`public.embeddings` rows with `plugin = 'memory'` —
  encrypted under the old DEK and never staged/re-encrypted across a
  rotation; see "DEK-encrypted memories" below). It also best-effort
  deletes input-media blobs and their ledger rows because their encrypted
  chat transcripts are now orphaned; generated/library media remains.
- `reset/abort`: drop `*_next` + the staged `vault_version+1`
  credentials, return to `ready`.
- `reset/commit` also deletes every passkey wrap (`user_passkeys`) — each
  seals the old DEK. See "Passkey wraps" below.

The browser-side DEK session lives in `lib/vault/session.tsx`, over the
persistence layer in `lib/vault/session-store.ts`. **The DEK is never at
rest in a readable form.** `localStorage` holds three blobs and no key
material: the PIN-wrapped DEK (Argon2id), a time-limited unlock
session wrapped under a **non-extractable `CryptoKey`** kept in
IndexedDB — the browser will not export those bytes to any caller, so a
profile-directory dump recovers nothing — and the **phrase keep**
(`lib/vault/phrase-keep.ts`): the recovery phrase AES-GCM-sealed under
the DEK, written by `unlock(dek, { phrase })` at the three moments the
phrase is in memory (creation, a phrase unlock, a rotation commit) and
read only by Settings → Vault, which unwraps the DEK from the PIN blob
with the PIN just typed and opens the keep with that — never with the
live session DEK. The keep grants exactly what the DEK already grants,
lives on the device alone (the server never sees the ciphertext), and
follows the PIN blob's lifecycle: it survives `lock()` and dies with
`forgetDevice()`. It is what let the setup flow drop its three-words-back
backup quiz. Every failure to open the session wrap (no IndexedDB, no
WebCrypto, key destroyed) degrades to "no session", i.e. the PIN prompt.

The session auto-locks at expiry, zeroes its in-memory DEK on lock,
forget-device and unmount, and **propagates across tabs**: each teardown
clears a `localStorage` key and a `storage` listener mirrors the lock,
the forget, the stale-DEK flag and a fresh unlock into every other open
tab. `lib/vault/device-access-cache.ts` holds the device-control seed for
grant signing, cleared on those same lifecycle events. `components/vault/{pin-flow,
require-unlocked,vault-lock-pill}` gate UI that needs an unlocked vault.

## CLI OpenLLM OAuth seal

`cli-auth-seal.ts` seals a plaintext `sk-llm-…` API key to the waiting CLI's
ephemeral X25519 public key during browser approve
([`docs/plan/2026-11-01-cli-install-onboarding.md`](../../docs/plan/2026-11-01-cli-install-onboarding.md)
§2). Envelope shape matches the connector seal (ephemeral X25519 →
HKDF-SHA256 → AES-256-GCM), but the HKDF domain and AAD bind
`openllm-cli-auth-seal-v1` + `userId` + `authorizationId` + recipient pubkey, so
connector and CLI ciphertext are not interchangeable. The server stores only
the JSON envelope in `cli_authorizations.sealed_key` and cannot open it. The
CLI unwraps on claim with its private key; claim retries return the same
envelope until the original authorization expiry. No OAuth access/refresh
tokens are sealed or retained — only the ordinary user-owned API key.

## Device handoff

A device with no PIN blob (the desktop app, another browser) can get the vault
from one of the account's unlocked devices instead of the recovery phrase
(`handoff.ts`; design, protocol and threat model in
[`docs/plans/vault-device-handoff.md`](../../docs/plans/vault-device-handoff.md)).
The new device mints an ephemeral X25519 key and posts its public half; the
unlocked device, after the user compares a six-digit code derived from the
server-chosen request id and that key, and pays its own unlock method (PIN or
passkey), seals `{ dek, phrase }` with `X25519 → HKDF-SHA256(salt = request
id, info = [user, request, vault_version, both public keys]) → AES-256-GCM`.
The new device re-derives the DEK from the phrase against `users.wrapped_dek`
before accepting it (`acceptHandoff`), which is what stops a session-cookie
holder from handing it a DEK of its own; a payload without a phrase is
refused, so only devices that keep the phrase are asked to approve. The server
(`/api/vault/handoff/*`, browser-session only) stores public keys, a token
hash and ciphertext — nothing that opens.

## Passkey wraps (WebAuthn PRF)

The third DEK wrapper, beside the phrase and the PIN
(`docs/plans/passkey-vault-unlock.md`):

| Wrapper | Input | KDF | Stored | Unlocks |
| --- | --- | --- | --- | --- |
| Phrase | 12 words (~128 bits) | Argon2id | `users.wrapped_dek` | any device |
| PIN | 4/6 digits | Argon2id | this browser only | the device that set it |
| Passkey | PRF output (256 bits) | HKDF-SHA256 | `user_passkeys.wrapped_dek` (+ the phrase in `sealed_phrase`) | any device the passkey syncs to |

- Per credential a random 32-byte `prf_salt` is evaluated as
  `prf.eval.first`; `wrap_key = HKDF-SHA256(prfOutput, salt = prf_salt,
  info = "openllm-vault-passkey-v1", 32)`; the DEK is AES-256-GCM sealed as
  base64 `IV || ct+tag`, with **AAD = info | credential id | vault_version**
  so a relabelled or swapped row fails its tag instead of yielding a DEK the
  session would stamp with the wrong generation. No Argon2: the input is
  256 bits from the authenticator, so unlock is instant.
- **Server-side is safe here, unlike a PIN** (`docs/plans/vault-pin-unlock.md`
  §2): without the authenticator there is no PRF output to guess, so a
  database leak yields ciphertext plus a public salt. The server never
  verifies an assertion and stores no public key — possession of a row grants
  nothing.
- **A passkey is a full local unlock method.** The session keeps a per-account
  *passkey link* (`lib/vault/passkey-link.ts`: credential id + generation, no
  key material) with the PIN blob's lifecycle (survives `lock()`, dies with
  `forgetDevice()`). The single readiness predicate is `needsLocalUnlock =
  DEK in memory ∧ ¬(PIN blob ∨ passkey link)`, read by `<RequireUnlocked>`,
  the unlock / setup / rotate dialogs, `useVaultReadiness` and the onboarding
  wizard. A passkey-only device therefore needs no PIN: within the
  keep-unlocked window the DEK rehydrates from the non-extractable IndexedDB
  wrap exactly as before; after it, one passkey ceremony re-enters. The link is
  a pointer, not a local copy of the wrap, so revoking a passkey in Settings
  revokes it on every device at once (the cost: a passkey unlock needs the
  network, which reading `vault_state` already does).
- **Onboarding commits on arrival; the unlock method comes after.** The
  getting-ready screen (`<StepGettingReady>`) commits the staged vault with NO
  local unlock method (`useCreateVault.commit`) and lets the user in
  (`docs/plans/onboarding-deferred-unlock.md`). The commit files a *secure
  deferral* record on that device (`lib/vault/secure-deferral.ts`, timestamps
  only), and `isSecureDeferred` (the record ∧ no method) decides three things:
  the session holds it OPEN (`HELD_OPEN_UNTIL_TS`: no auto-lock, survives
  reloads), so the DEK never lapses into "only the phrase gets you back in";
  `<RequireUnlocked>` and `useVaultReadiness` serve it; and the UI's Lock asks
  for a method first (`useLockVault`), then locks once one is set. The first
  method clears the record and re-stamps the chosen window; so do `lock()`,
  `forgetDevice()` and any unlock under another vault generation (a reset or
  rotation elsewhere), and a record that cannot be stored grants nothing. The
  three gates read one predicate, `canServeVault`. Any other device with no method (a phrase or
  handoff unlock) keeps its normal window, locks normally, and still meets
  `set` mode at the gate. `<UnlockMethodPrompt>` (app shell) asks — banner, then a
  modal that cannot be dismissed on a second visit or after three days. The
  dashboard's `<VaultSetupDialog>` still commits on the PIN or passkey
  (`save` / `savePasskey`), ceremony BEFORE `/api/vault/commit`.
- **Phrase reveal** (Settings → Vault) pays the device's own method: the PIN
  unwraps the PIN blob, or a passkey ceremony unwraps a private DEK from the
  passkey wrap (or opens the passkey's own sealed copy, below); the reveal
  never reads the live session DEK.
- **The phrase rides on the passkey too** (`user_passkeys.sealed_phrase`,
  `docs/plans/vault-phrase-sync.md`): `sealPhraseWithPrf` seals it under
  `HKDF(prfOutput, salt = prf_salt, info = "openllm-vault-passkey-phrase-v1")`
  with the same AAD shape, so any device the passkey syncs to can show the
  words after a ceremony, without a local keep. **Never under the DEK**: the
  server holds the DEK transiently on every `sk-llm` request
  (`dek_for_key`), and the phrase is more than the DEK — it derives the
  device-control seed the server must never reach.
  - **Filed only where the flow proved the person:** vault creation and the
    rotation re-file (the phrase was just minted; rotation's confirm step pays
    the method); adding a passkey on a PIN device, which now REQUIRES the PIN
    (`TPasskeyEnrollProof` — the keep is opened with the DEK unwrapped from
    the PIN blob, not the session's); adding a first method on a device with
    none; and a passkey unlock backfilling an empty row **through the passkey
    this device is already linked to**. Never on `link()`, never through
    another passkey of the account, never on a second passkey added to a
    passkey-only device. The add/link paths open the local keep with a DEK
    the session already holds (`withDek`), which is why each is gated above.
  - The backfill PATCH is fill-only and generation-fenced (`sealed_phrase IS
    NULL AND vault_version = :v`), so a tab with a stale list can't replace a
    fresher copy. A re-enroll without the field clears the old copy.
  - **A passkey can reach the device-control seed.** Reading the copy never
    installs the phrase locally, but whoever can open it can read the words and
    type them into "Verify this browser". So every passkey that holds a copy
    is as strong as the phrase itself; the gates above exist for that reason.
    Not a backup: losing every device and the passkey loses this copy too.
- Rotation: `reset/commit` deletes every `user_passkeys` row. The rotate
  flow (`lib/hooks/use-vault-rotation.ts`) keeps THIS device's method across
  the switch without asking for a new one: it mints the new DEK when the
  dialog opens, and its confirm step — the device's PIN or passkey — proves
  the method AND seals the new DEK under it (`wrapDekWithPin`, or
  `usePasskeyRewrap`: one assertion, wrap bound to `vault_version+1`). After
  the commit the PIN blob is installed with `unlock`, or the passkey wrap is
  re-filed (an upsert by credential id) and linked. Passkeys on other devices
  need turning on again. A device with neither is let in and asked later
  (`deferLocalUnlock`). `rp.id` is the production apex (`openllm.sh`, shared by `www` and
  `dev`); `localhost` and preview hosts mint their own credentials.
- Residual risk, accepted: onboarding defers the phrase backup, so a user
  who deletes their only passkey from the OS keychain before saving the
  phrase (or adding a PIN) must reset the vault — the same class of risk as a
  forgotten PIN today, and narrower, because the passkey syncs. Deferring the
  unlock method adds one more: an unsecured device that loses its browser
  data (or is forgotten) before a method is chosen has only the phrase,
  which the user has not saved yet — a reset. The held-open session means a
  lapse never causes it, and the forced prompt bounds how long it can last.
  Separately, an unsecured device stays unlocked with no time bound until a
  method exists; at rest the DEK is still ciphertext under the
  non-extractable IndexedDB key, so this widens who can use an unattended
  browser, not what is on disk.

## DEK-encrypted memories

Saved memories (the memory plugin's rows in `public.embeddings`)
are AES-256-GCM encrypted **at rest** under the same DEK, reusing
`encryptCredential` / `decryptCredential`: `content` holds base64
ciphertext, `content_nonce` the base64 nonce, `vault_version` the DEK
generation (`content_nonce IS NULL` ⇒ legacy plaintext row, lazily
encrypted by a background sweep on the next DEK-bearing request).
Because every `sk-llm` key from the same phrase wraps the same DEK, a
memory saved through key A is readable through key B for free.

**This is at-rest encryption, not zero-knowledge** — weaker than the
credential story above, equal to the `/v1/*` trust level:

- Memory plaintext transits the server (and Bedrock, for embedding)
  inside a request window opened by a valid key; the DEK is `zero()`d
  in the dispatcher's `finally`.
- **The embedding vector stays plaintext** — pgvector similarity search
  cannot run over ciphertext. A 1024-d vector leaks semantic content
  (embedding-inversion attacks reconstruct approximate text): anyone
  with DB access learns *what a memory is about*, not its wording.
- Session-cookie reads (the dashboard) carry no DEK server-side; the
  API returns ciphertext + `encrypted: true` and the browser decrypts
  with the unlocked vault session.
- Rotation wipes memories rather than re-encrypting them: re-encrypt
  would need old and new DEK live server-side simultaneously (or an
  unbounded browser round-trip). Wipe matches the rotation's existing
  blast radius ("all API keys revoked").

## Team key graph

User-held team encryption (`team.ts`; `docs/plan/2026-10-26-teams.md` §9).
OpenLLM never sees T in plaintext. The graph is one-way: team material cannot
open personal rows.

```
personal DEK  ──seal──►  team_members.sealed_team_key          (T)
invite secret ─HKDF(auth info)──►  auth (base64url)  ──sha256──►  token_hash
invite secret ─HKDF(wrap info)──►  wrap key  ──seal──►  team_invites.wrapped_team_key (T)
T             ─HKDF──►  K_mem     ──seal──►  embeddings.content (team rows)
T             ─HKDF──►  K_cred    ──seal──►  team share credential (inner layer)
                                                ▲
                                   server K_srv wraps that as outer layer
                                   (HMAC-SHA256 of host signing secret;
                                    packages/api/lib/team-cred-wrap.ts)
```

- **Create (browser, vault unlocked):** `generateTeamKey()` → seal T under the
  owner's DEK (`sealTeamKey`) → persist `sealed_team_key`. Invite links carry
  a fragment secret that **never leaves the browser**. From it the browser
  derives two independent HKDF outputs with distinct info labels:
  `auth = deriveTeamInviteAuth(secret, invite_id)` (info
  `openllm-team-invite-auth-v1`, posted as the request `auth` field; server
  stores only `sha256(auth)` as `token_hash`) and
  `wrap = deriveTeamInviteWrapKey(secret, invite_id)` (info
  `openllm-team-invite-v1`, used only to build
  `wrapped_team_key = wrapTeamKeyForInvite(secret, invite_id, T)`). The create
  response is id-only — the client builds `/join#<id>.<secret>` itself.
- **Join (vault unlocked):** browser derives `auth` again for preview/join
  POSTs, then `unwrapTeamKeyFromInvite` (wrap key stays local) →
  `sealTeamKey` under the joiner's DEK. Joining without an unlocked vault
  cannot seal a copy. From everything the server sees or stores
  (`invite_id`, `auth`, `token_hash`, `wrapped_team_key`, `key_version`)
  unwrapping T fails.
- **Request / memory path:** DEK → `openTeamKey` → T → `deriveTeamMemKey` →
  `K_mem`. Team-row encrypt/decrypt (`encryptTeamMemory` /
  `decryptTeamMemory`) accept **only** `K_mem`, never the personal DEK.
- **API-key share path (inner layer):** DEK → `openTeamKey` → T →
  `deriveTeamCredKey` → `K_cred`. The supplier's browser decrypts its own
  credential blob under the personal DEK, then re-encrypts under `K_cred`
  with AAD binding `(team_id, share_id, provider, key_version)` via
  `encryptTeamCredential`. The server wraps that packed inner ciphertext
  under per-share `K_srv` before storage (`team_shares.payload_ciphertext`).
  At request time the member opens T the same way; the server removes the
  outer layer; `K_cred` removes the inner. Neither layer alone opens the
  credential. `NEON_AUTH_COOKIE_SECRET` absent → sharing fails closed
  (`team_credential_unavailable`).
- **Domain separation:** invite auth info `openllm-team-invite-auth-v1`;
  invite wrap info `openllm-team-invite-v1`; memory info
  `openllm-team-mem-v1`; credential info `openllm-team-cred-v1`. Auth ≠ wrap
  key ≠ `K_mem` ≠ `K_cred` ≠ DEK ≠ `K_srv`. Personal credentials, personal
  memory, and `api_keys.dek_for_key` / `secret_ciphertext` stay under the
  personal DEK (or the API-key wrap key); T / `K_mem` / `K_cred` / invite
  wrap fail GCM auth on them. Each team's T is independent — T₁ cannot open
  T₂'s sealed copy, memories, or credential shares. A former member with T
  but without the server outer layer gets nothing.
- **Vault reset:** clears this account's `sealed_team_key` copies only. Team
  ciphertext and other members' seals remain. Re-join (or re-seal from an
  unlocked device that still holds T) restores access.
- **Zeroing:** callers `zero()` T, `K_mem`, and `K_cred` after use (same
  hygiene as the personal DEK).

Isolation is enforced by `tests/vault/team-key-isolation.test.ts` and
`tests/vault/team-invite-auth-wrap.test.ts` against the real primitives (no
crypto stubs).

## Layering rules

- `packages/sdk/vault` depends on nothing app-specific. Pure bytes-in/bytes-out
  primitives run identically in the browser and on the proxy.
