# byok-browser-vault

Browser-native BYOK vault for serverless/local-first AI apps.

## Security Reality Check (Read First)

- This project has **not** been formally audited.
- It protects against passive issues (plaintext keys in storage, accidental exposure, low-effort scraping).
- It does **not** protect against active in-origin script injection (XSS). If malicious JS executes on your origin, it can still intercept decrypted keys in-flight.
- `sessionStorage` caching is a UX optimization to reduce passphrase prompts, **not** a stronger security boundary.

If your threat model requires resistance to active injection attacks, use a server-side proxy.

## What It Provides

- AES-GCM encryption at rest in `localStorage`.
- PBKDF2 key derivation (default `200,000` iterations) with per-user random salt.
- Scoped key access via `withKey(async (key) => { ... })`.
- Optional token circuit breaker with:
  - pre-flight soft check (`requestedTokens`)
  - post-call hard accounting (`reportUsage(tokens)`)
  - dev warning when `withKey` finishes without `reportUsage`.
- `nuke()` reset flow to clear encrypted key and session state.

## Install

```bash
npm install byok-browser-vault
```

## Quick Start

```ts
import { BYOKVault } from "byok-browser-vault";

const vault = new BYOKVault({
  maxTokens: 30_000,
  minPassphraseLength: 8
});

await vault.setKey(userApiKey, userPassphrase);
await vault.unlock(userPassphrase);

await vault.withKey(
  async (key) => {
    const response = await fetch("https://api.example.com/llm", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt: "hello" })
    }).then((r) => r.json());

    const used = response.usage.total_tokens;
    vault.reportUsage(used); // hard usage accounting
  },
  {
    requestedTokens: 1200 // optional soft pre-flight estimate
  }
);
```

## Circuit Breaker Notes

- `requestedTokens` check is a soft guardrail based on your estimate.
- `reportUsage(tokens)` is the hard truth.
- When limit is exceeded, the **next** request is blocked with a hard error.
- In dev mode, vault warns if `withKey` completes without `reportUsage`.

## Provider Usage Parsing Snippets

OpenAI-style:

```ts
const tokens = response.usage?.total_tokens ?? 0;
vault.reportUsage(tokens);
```

Anthropic-style:

```ts
const input = response.usage?.input_tokens ?? 0;
const output = response.usage?.output_tokens ?? 0;
vault.reportUsage(input + output);
```

## API

```ts
new BYOKVault(options?)
```

Options:

- `namespace?: string` storage key prefix (default `byok-browser-vault`)
- `minPassphraseLength?: number` default `8`
- `pbkdf2Iterations?: number` default `200000`
- `maxTokens?: number` enables circuit breaker
- `devMode?: boolean` defaults to `NODE_ENV !== "production"` when available
- `localStorage?: Storage` / `sessionStorage?: Storage` for testing/custom storage
- `logger?: { warn(message: string): void }` custom warning sink

Methods:

- `setKey(apiKey, passphrase): Promise<void>`
- `unlock(passphrase): Promise<void>`
- `withKey(callback, { requestedTokens?, passphrase? }): Promise<T>`
- `reportUsage(tokens): void`
- `getUsage(): number`
- `getRemainingTokens(): number`
- `getMaxTokens(): number | null`
- `hasStoredKey(): boolean`
- `isLocked(): boolean`
- `getEncryptedBlob(): EncryptedKeyBlob | null`
- `nuke(): void`

## Threat Model and Limitations

- JavaScript cannot force immediate memory zeroization of strings; decrypted keys can remain in heap memory until GC.
- Passphrase quality matters. A short PIN (for example 4 digits) is brute-forceable even with high PBKDF2 iteration counts.
- This package intentionally has zero runtime dependencies, but still has normal dev dependencies for build/test tooling.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run demo
```
