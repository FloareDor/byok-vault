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

## Basic Usage (Passphrase)

```ts
import { BYOKVault } from "byok-vault";

const vault = new BYOKVault();

await vault.setConfig(
  {
    apiKey: userApiKey,
    provider: "openai",
    organizationId: userOrgId
  },
  userPassphrase
);

await vault.withConfig(async (config) => {
  await fetch("https://api.example.com/llm", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt: "hello" })
  });
});
```

## Optional: Passkey Unlock (WebAuthn)

```ts
const vault = new BYOKVault();

await vault.setConfigWithPasskey(
  {
    apiKey: userApiKey,
    provider: "openai"
  },
  {
    rpName: "Your App Name",
    userName: currentUser.email
  }
);

vault.lock();
await vault.unlockWithPasskey();
```

## Typical Flow

1. Ask user for API config (`apiKey` plus optional metadata).
2. Choose unlock mode:
   - passphrase: `setConfig(...)`
   - passkey: `setConfigWithPasskey(...)`
3. Use `withConfig` (or `withKey`) for each provider call.
4. Let user reset with `nuke()`.

::: details Optional: Add Token Budget (Circuit Breaker)

```ts
const vault = new BYOKVault({
  maxTokens: 30_000,
  hardMinTokens: 5_000,
  hardMaxTokens: 100_000
});

// optional: apply user-selected budget inside developer bounds
vault.setMaxTokens(50_000);

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
  {
    requestedTokens: 1200
  }
);
```

Only use this when you want per-session token limits. Runtime overrides are
available via `setMaxTokens(...)` and constrained by optional hard bounds.
:::

## Security Notes

Source: https://floaredor.github.io/byok-vault/guide/security

# Security Notes

## What This Package Helps With

- Avoids storing API keys as plaintext in browser storage.
- Uses PBKDF2 + AES-GCM for passphrase mode encryption at rest.
- Supports passkey-based unlock for biometric UX on supported platforms.
- Keeps decrypted key/config access inside a callback.

## What This Package Does Not Solve

- It does not stop active XSS attacks.
- If malicious JavaScript runs in your origin, it can still read keys in-flight.
- JavaScript cannot force immediate memory wipe of strings.
- Passkey support depends on browser/authenticator capabilities (WebAuthn + PRF path).

## Practical Advice

- Use a strong passphrase UX.
- If you offer passkeys, keep passphrase fallback for unsupported devices.
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
- `hardMinTokens?: number` (default `1` when breaker is enabled)
- `hardMaxTokens?: number` (optional runtime ceiling)
- `devMode?: boolean`
- `localStorage?: Storage`
- `sessionStorage?: Storage`
- `logger?: { warn(message: string): void }`
- `passkeyAdapter?: PasskeyAdapter`

`hardMinTokens` / `hardMaxTokens` require `maxTokens`.

## Methods

- `setKey(apiKey, passphrase): Promise<void>`
- `setConfig(config, passphrase): Promise<void>`
- `setConfigWithPasskey(config, options): Promise<void>`
- `unlock(passphrase): Promise<void>`
- `unlockWithPasskey(options?): Promise<void>`
- `withKey(callback, { requestedTokens?, passphrase? }): Promise<T>`
- `withConfig(callback, { requestedTokens?, passphrase? }): Promise<T>`
- `reportUsage(tokens): void`
- `getUsage(): number`
- `getRemainingTokens(): number`
- `getMaxTokens(): number | null`
- `setMaxTokens(limit): void`
- `getHardMinTokens(): number | null`
- `getHardMaxTokens(): number | null`
- `hasStoredKey(): boolean`
- `isPasskeyEnrolled(): boolean`
- `isLocked(): boolean`
- `getEncryptedBlob(): EncryptedKeyBlob | null`
- `lock(): void`
- `nuke(): void`

Passkey methods (`setConfigWithPasskey`, `unlockWithPasskey`) require a passkey-capable environment.

## Error Codes

- `PASSPHRASE_POLICY`
- `PBKDF2_POLICY`
- `KEY_NOT_FOUND`
- `VAULT_LOCKED`
- `WRONG_PASSPHRASE`
- `INVALID_USAGE_REPORT`
- `CIRCUIT_BREAKER_LIMIT`
- `CIRCUIT_BREAKER_DISABLED`
- `PASSKEY_NOT_SUPPORTED`
- `PASSKEY_NOT_ENROLLED`
- `PASSKEY_UNLOCK_FAILED`
