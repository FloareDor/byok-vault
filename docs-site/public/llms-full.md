# byok-vault LLM Docs

Source site: https://floaredor.github.io/byok-vault

This file is generated from VitePress Markdown and intended for LLM ingestion.

## Getting Started

Source: https://floaredor.github.io/byok-vault/guide/getting-started

# Getting Started

## Install

```bash
npm install byok-vault
```

## Basic Usage

```ts
import { BYOKVault } from "byok-vault";

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

    const used = response.usage?.total_tokens ?? 0;
    vault.reportUsage(used);
  },
  { requestedTokens: 1200 }
);
```

## Typical Flow

1. Ask user for API key and passphrase.
2. Save once with `setKey`.
3. Use `withKey` for each provider call.
4. Call `reportUsage(tokens)` after each successful response.
5. Let user reset with `nuke()`.

## Security Notes

Source: https://floaredor.github.io/byok-vault/guide/security

# Security Notes

## What This Package Helps With

- Avoids storing API keys as plaintext in browser storage.
- Uses PBKDF2 + AES-GCM for encryption at rest.
- Keeps decrypted key access inside a callback.

## What This Package Does Not Solve

- It does not stop active XSS attacks.
- If malicious JavaScript runs in your origin, it can still read keys in-flight.
- JavaScript cannot force immediate memory wipe of strings.

## Practical Advice

- Use a strong passphrase UX.
- Add a clear reset path (`nuke()`).
- Use CSP and strict input sanitization in your app.
- For high-security threat models, use a server-side proxy.

## OpenRouter Comparison

Source: https://floaredor.github.io/byok-vault/guide/comparisons

# Why not use OpenRouter BYOK?

OpenRouter is a fantastic platform for LLM routing, and their Bring-Your-Own-Key feature is great if you want managed infrastructure. However, it is fundamentally a **server-side proxy**.

Use `byok-vault` instead of OpenRouter BYOK if you are building a **local-first** application and need:

1. **Zero Onboarding Friction:** OpenRouter BYOK requires your users to leave your app, create an OpenRouter account, paste their OpenAI/Anthropic key into OpenRouter's dashboard, generate a *new* proxy key, and paste that back into your app. With `byok-vault`, users paste their key directly into your app and start working immediately.
2. **Zero Middlemen:** OpenRouter requires users to store their API keys on OpenRouter's servers, and all API calls are routed through their backend. `byok-vault` keeps the key strictly inside the user's browser. It never touches a server.
3. **Zero Proxy Fees:** While OpenRouter offers a generous free tier for BYOK, high-volume apps eventually hit a 5% routing tax just to use their own keys. `byok-vault` talks directly to the LLM provider: no proxy, no tax.

## API

Source: https://floaredor.github.io/byok-vault/guide/api

# API

## Constructor

```ts
new BYOKVault(options?)
```

### Main Options

- `namespace?: string`
- `minPassphraseLength?: number` (default `8`)
- `pbkdf2Iterations?: number` (default and minimum `200000`)
- `maxTokens?: number` (turns on circuit breaker)
- `devMode?: boolean`
- `localStorage?: Storage`
- `sessionStorage?: Storage`
- `logger?: { warn(message: string): void }`

## Methods

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
- `lock(): void`
- `nuke(): void`

## Error Codes

- `PASSPHRASE_POLICY`
- `PBKDF2_POLICY`
- `KEY_NOT_FOUND`
- `VAULT_LOCKED`
- `WRONG_PASSPHRASE`
- `INVALID_USAGE_REPORT`
- `CIRCUIT_BREAKER_LIMIT`
- `CIRCUIT_BREAKER_DISABLED`
