<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/openllmsh/sdk/main/assets/openllm-light.svg">
    <img alt="OpenLLM" src="https://raw.githubusercontent.com/openllmsh/sdk/main/assets/openllm.svg" width="300">
  </picture>
</p>

<p align="center"><b>@openllmsh/sdk</b> — everything a client needs to talk to OpenLLM.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@openllmsh/sdk"><img alt="npm" src="https://img.shields.io/npm/v/@openllmsh/sdk.svg"></a>
  <a href="https://www.npmjs.com/package/@openllmsh/sdk?activeTab=versions"><img alt="npm next" src="https://img.shields.io/npm/v/@openllmsh/sdk/next.svg?label=next"></a>
  <a href="https://github.com/openllmsh/sdk/blob/main/LICENSE"><img alt="License: Apache-2.0 AND BUSL-1.1" src="https://img.shields.io/badge/license-Apache--2.0%20%2B%20BUSL--1.1-blue.svg"></a>
  <img alt="types included" src="https://img.shields.io/badge/types-included-blue.svg">
</p>

---

The same code the OpenLLM browser app, the `openllm` CLI and its local daemon
run, published as one package. Typed contracts, wire-format transforms, the
device tunnel, client-side vault crypto, the HTTP API spec and the MCP tools,
under a single version.

- **One package, imported by subpath.** No root barrel. Pull in
  `@openllmsh/sdk/protocol`, `/vault` or `/client` and nothing else comes along.
- **Zero-knowledge by construction.** Provider keys are sealed in the client
  under a key the server never sees in plaintext; `vault` holds the crypto
  (Argon2id, AES-256-GCM, HKDF, X25519 seals) and zeroes key material on close.
- **I/O injected, runs anywhere.** `client` and `mcp` take `fetch`, `WebSocket`
  and an RTC factory from the host, so the same code runs in the browser, in
  Bun and in Node.
- **One contract for HTTP and MCP.** `openapi` ships the public spec with a
  typed `callOperation()`; `mcp` derives its tools from the same operations.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the layers and which may import
which.

## Install

```sh
npm install @openllmsh/sdk        # or: bun add / pnpm add / yarn add
npm install @openllmsh/sdk@next   # the latest prerelease
```

Versions follow the OpenLLM release version. Each npm release is published by
CI from this repository with [provenance](https://docs.npmjs.com/generating-provenance-statements);
the same source is tagged here, so `bun add github:openllmsh/sdk#vX.Y.Z` pins
the identical code.

### Runtimes

ESM only. The npm package ships compiled JavaScript with type declarations, so
it runs anywhere modern JavaScript does:

| Where | Notes |
| --- | --- |
| Node 20.19+ / 22+ | `import` it from an ESM module (`"type": "module"` or `.mjs`). |
| Bun | Import it directly. |
| Browsers, via a bundler | Vite, esbuild, webpack, Next.js, Rollup. |
| TypeScript | `"moduleResolution"` set to `NodeNext` or `Bundler`. |

The git tags here carry the TypeScript source instead, which Bun runs as is.

## Quickstart

```ts
import { createClient } from "@openllmsh/sdk/client";

const ollm = createClient({
  origin: "https://www.openllm.sh",
  apiKey, // sk-llm-…
  transport: { fetch, websocket: WebSocket },
});

// Streaming chat: a fetch Response whose body is the SSE stream.
const res = await ollm.chat.completions.create(
  { model: "plus", messages, stream: true },
  { signal },
);

// Any public API operation, typed from the spec.
await ollm.http.call("marketplace.launch", {});

ollm.close(); // zeroes key material, closes device channels
```

### Vault

```ts
// Unwrap the data key with the server's dek_for_key blob for this API key.
await ollm.vault.unlockFromApiKey(dekForKeyB64);

const sealed = await ollm.vault.sealToDevice(devicePubSpkiB64, secret);
const encrypted = await ollm.vault.encryptCredential(JSON.stringify(creds));

// Borrow the API-key secret; it is zeroed when the callback returns or throws.
await ollm.vault.withApiKeySecret((secret, id) => use(secret, id));
```

A browser host that has already unlocked the vault (PIN or passkey) passes
`{ dek }` to `createClient` instead.

### Devices

```ts
const ollm = createClient({
  origin,
  apiKey,
  transport: {
    fetch,
    websocket: WebSocket,
    rtc: (config) => new RTCPeerConnection(config),
  },
  devices: { mux: muxDeps, ladder: ladderDeps },
});

const device = ollm.devices.open(deviceId);
await device.openOverLadder(async (channel, budget, path) => {
  // agentStream(…) over WebRTC, falling back to the relay mux
});
```

The SDK owns the relay-mux open path and the WebRTC → mux failover; the host
still negotiates the WebRTC channel itself.

### Lower layers

```ts
import { ChatCompletionRequest } from "@openllmsh/sdk/protocol";
import { fromAnthropicMessagesRequest } from "@openllmsh/sdk/wire/adapters/messages";
import { isValidMuxFrame } from "@openllmsh/sdk/tunnel/codec";
import { parseApiKey, sealCliAuth } from "@openllmsh/sdk/vault";
```

## Subpaths

| Subpath | Contents |
| --- | --- |
| `@openllmsh/sdk/protocol` | Effect Schema contracts: request/response, streaming, provider, daemon and relay wire shapes. |
| `@openllmsh/sdk/wire` | Pure wire-format transforms: Anthropic ↔ OpenAI adapters, SSE, token estimates. Shared by the cloud proxy and the daemon. |
| `@openllmsh/sdk/tunnel` | Sans-I/O binary mux, device grants, WebRTC helpers, Noise_IK. The relay imports only `/codec` and `/channel-envelope`. |
| `@openllmsh/sdk/vault` | Client-side crypto, DEK-carrying API keys and X25519 seals. **Only the barrel is stable public API**; `vault/*` files are internal. |
| `@openllmsh/sdk/openapi` | The committed OpenAPI spec, the operations table and `callOperation()`. |
| `@openllmsh/sdk/openapi/spec.json` | The OpenAPI document itself, as served at `/api/swagger`. |
| `@openllmsh/sdk/mcp` | MCP tool definitions (API, memory, marketplace upstreams) and `createMcpServer` over an injected transport. |
| `@openllmsh/sdk/connect` | "Connect with OpenLLM" for your app's server: `createConnect` and `connectRoutes`. |
| `@openllmsh/sdk/client` | The facade above: vault session, HTTP and chat, device tunnel. Composition only — no protocol or crypto of its own. |

## License

The package root is **Apache-2.0** ([`LICENSE`](./LICENSE)), covering
`protocol/`, `openapi/`, `mcp/` and `client/`.

`wire/`, `tunnel/` and `vault/` carry their own `LICENSE` under the
**Business Source License 1.1**, which governs those folders instead of the
root. Importing them brings in the BUSL competing-service clause.

| Path | License |
| --- | --- |
| `protocol/`, `openapi/`, `mcp/`, `client/` | Apache-2.0 |
| `wire/`, `tunnel/`, `vault/` | BUSL-1.1 |

`package.json` declares `"license": "(Apache-2.0 AND BUSL-1.1)"`.
