# `@openllmsh/sdk`

Public OpenLLM SDK: typed protocol contracts, wire-format transforms, the
sans-I/O tunnel mux, zero-knowledge vault crypto, the public OpenAPI surface,
and MCP tool defs. Install from GitHub:

```bash
bun install github:openllmsh/sdk#vX.Y.Z
```

There is **no root barrel** — import by subpath so each consumer only pulls
what it needs:

```ts
import { ChatCompletionRequest } from "@openllmsh/sdk/protocol";
import { anthropicToOpenAI } from "@openllmsh/sdk/wire/adapters/messages";
import { isValidMuxFrame } from "@openllmsh/sdk/tunnel/codec";
import { sealCliAuth, parseApiKey } from "@openllmsh/sdk/vault";
import { createClient } from "@openllmsh/sdk/client";
```

### Client quickstart (vault session)

```ts
const ollm = createClient({
  origin: "https://openllm.sh",
  apiKey, // sk-llm-…
  transport: { fetch, websocket: WebSocket },
});

// Unwrap the DEK when you already have the server's dek_for_key blob:
await ollm.vault.unlockFromApiKey(dekForKeyB64);
const sealed = await ollm.vault.sealToDevice(devicePubSpkiB64, secret);
const enc = await ollm.vault.encryptCredential(JSON.stringify(creds));
ollm.close(); // zeros the DEK
```

Browser hosts can pass an already-unlocked DEK via `{ dek }` (PIN/passkey
glue stays in the app).

```ts
// Typed OpenAPI call (one HTTP surface via callOperation):
await ollm.http.call("marketplace.launch", {});

// Streaming chat — returns a fetch Response whose body is the SSE stream:
const stream = await ollm.chat.completions.create(
  { model: "plus", messages, stream: true },
  { signal },
);
```

Device tunnels land next on the same `createClient` object.

## Subpaths

| Subpath | Contents |
| --- | --- |
| `@openllmsh/sdk/protocol` | Effect-Schema contracts for clients: request/response, streaming, provider, daemon, and relay wire shapes. |
| `@openllmsh/sdk/wire` | Pure wire-format transforms (Anthropic↔OpenAI adapters, SSE, token estimate). Shared by the cloud proxy and the local daemon. |
| `@openllmsh/sdk/tunnel` | Sans-I/O binary mux, device grants, RTC helpers, Noise_IK. Relay imports only `/codec` and `/channel-envelope`. |
| `@openllmsh/sdk/vault` | Zero-knowledge crypto (Argon2id + AES-256-GCM + HKDF), DEK-carrying API keys, X25519 seals. **Only the barrel is stable public API** — `vault/*` subpaths are internal and may change without a major bump. |
| `@openllmsh/sdk/openapi` | Committed OpenAPI spec + operations table + `callOperation()`. |
| `@openllmsh/sdk/openapi/spec.json` | The sanitized OpenAPI document (same sanitize as `/api/swagger`). |
| `@openllmsh/sdk/mcp` | MCP tool defs (native API, memory, HTTP marketplace upstreams) and `createMcpServer` over an injected transport. |
| `@openllmsh/sdk/client` | I/O-injected facade: vault session today; HTTP + device tunnel next. Composition only — no new crypto. |

## Licence

| Path | Licence |
| --- | --- |
| `protocol/`, `openapi/`, `mcp/`, `client/` (and the package root) | Apache-2.0 |
| `wire/` | BUSL-1.1 |
| `tunnel/` | BUSL-1.1 |
| `vault/` | BUSL-1.1 |

`package.json` declares `"license": "(Apache-2.0 AND BUSL-1.1)"`. The BUSL
folders carry their own `LICENSE` which overrides the root for those paths;
adopters who import `wire`, `tunnel` or `vault` take on the BUSL
competing-service clause.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the layering rules.
