# `@openllmsh/sdk`

Public OpenLLM SDK: typed protocol contracts, wire-format transforms, the
sans-I/O tunnel mux, and zero-knowledge vault crypto. Install from GitHub:

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
```

## Subpaths

| Subpath | Contents |
| --- | --- |
| `@openllmsh/sdk/protocol` | Effect-Schema contracts for clients: request/response, streaming, provider, daemon, and relay wire shapes. |
| `@openllmsh/sdk/wire` | Pure wire-format transforms (Anthropic↔OpenAI adapters, SSE, token estimate). Shared by the cloud proxy and the local daemon. |
| `@openllmsh/sdk/tunnel` | Sans-I/O binary mux, device grants, RTC helpers, Noise_IK. Relay imports only `/codec` and `/channel-envelope`. |
| `@openllmsh/sdk/vault` | Zero-knowledge crypto (Argon2id + AES-256-GCM + HKDF), DEK-carrying API keys, X25519 seals. **Only the barrel is stable public API** — `vault/*` subpaths are internal and may change without a major bump. |

## Licence

| Path | Licence |
| --- | --- |
| `protocol/` (and the package root) | Apache-2.0 |
| `wire/` | BUSL-1.1 |
| `tunnel/` | BUSL-1.1 |
| `vault/` | BUSL-1.1 |

`package.json` declares `"license": "(Apache-2.0 AND BUSL-1.1)"`. The BUSL
folders carry their own `LICENSE` which overrides the root for those paths;
adopters who import `wire`, `tunnel` or `vault` take on the BUSL
competing-service clause.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the layering rules.
