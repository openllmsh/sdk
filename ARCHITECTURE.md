# `@openllmsh/sdk` architecture

One workspace package, seven internal layers. Boundaries that used to be
enforced by separate `package.json` deps are enforced by
`tests/sdk/layering.test.ts`.

```
protocol  ←  wire
          ←  tunnel  ←  vault
          ←  openapi
openapi + protocol  ←  mcp
any SDK layer       ←  client   (no node:*)
```

| Folder | May import | Detail |
| --- | --- | --- |
| `protocol/` | `effect` only | Public Effect-Schema contracts. See `protocol/README.md`. |
| `wire/` | `effect`, `@openllmsh/sdk/protocol` | Pure wire transforms. See `wire/ARCHITECTURE.md`. |
| `tunnel/` | `@openllmsh/sdk/protocol`, `effect` | Sans-I/O mux / RTC / Noise. See `tunnel/ARCHITECTURE.md`. |
| `tunnel/codec*`, `tunnel/channel-envelope` | nothing outside themselves | Relay-safe subpaths. |
| `vault/` | `@openllmsh/sdk/protocol`, `@openllmsh/sdk/tunnel`, `@noble/ed25519`, `@scure/bip39`, `hash-wasm` | Zero-knowledge crypto. See `vault/ARCHITECTURE.md`. |
| `openapi/` | `@openllmsh/sdk/protocol` (+ committed JSON) | Spec + operations table + `callOperation`. |
| `mcp/` | `@openllmsh/sdk/openapi`, `@openllmsh/sdk/protocol`, `@openllmsh/sdk/client`, `@modelcontextprotocol/server` | Tool defs + `createMcpServer`; no `node:*`. |
| `client/` | any SDK layer; no `node:*` | I/O-injected facade (`createClient`): vault session, then HTTP, then device tunnel. |

Rules that apply to every folder:

- Never `@openllm/{schema,core,db,api}`.
- No `node:*` outside the allow-list (`protocol/url-locality-dns.ts`,
  `tunnel/rtc-ice.ts`).
- No nested `package.json` under `packages/sdk/*/`.
- BUSL folders (`wire/`, `tunnel/`, `vault/`) each keep their own `LICENSE`.

Intra-SDK imports use the package's own name (`@openllmsh/sdk/protocol`) so
the public mirror is byte-identical to `packages/sdk` apart from the version
stamp. There is no `"."` root export — a root barrel would re-couple the
layers and drag vault's WASM into the relay bundle.

Published as one mirror (`openllmsh/sdk`) by `git subtree split
--prefix=packages/sdk`. The CLI mirror pins a single
`"@openllmsh/sdk": "github:openllmsh/sdk#<tag>"`.
