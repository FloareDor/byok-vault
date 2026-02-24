# byok-vault

[![npm version](https://img.shields.io/npm/v/byok-vault.svg)](https://www.npmjs.com/package/byok-vault)
[![license](https://img.shields.io/npm/l/byok-vault.svg)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/byok-vault)](https://bundlephobia.com/package/byok-vault)

Browser-native BYOK vault for serverless/local-first AI apps.
Docs site: https://floaredor.github.io/byok-vault/

### Why?
Building serverless AI apps still forces a bad tradeoff: run a backend only to hide API keys, or ask users to paste raw keys into a plaintext browser field.

### What?
`byok-vault` is a tiny browser library that encrypts each user API key locally with a passphrase. Keys are only decrypted for the exact scope of an API call via `withKey(...)`, and an optional token circuit breaker helps prevent unbounded calls without user awareness.

## Security Reality Check (Read First)

- This project has **not** been formally audited.
- It protects against passive issues (plaintext keys in storage, accidental exposure, low-effort scraping).
- It does **not** protect against active in-origin script injection (XSS). If malicious JS executes on your origin, it can still intercept decrypted keys in-flight.
- `sessionStorage` caching is a UX optimization to reduce passphrase prompts, **not** a stronger security boundary.

If your threat model requires resistance to active injection attacks, use a server-side proxy.

## What It Provides

- AES-GCM encryption at rest in `localStorage`.
- PBKDF2 key derivation (default `200,000` iterations) with per-user random salt.
- Encrypted JSON vault config support (`apiKey` + metadata such as org/model preferences).
- Scoped key access via `withKey(async (key) => { ... })`.
- Optional passkey unlock flow (`setConfigWithPasskey` / `unlockWithPasskey`) for biometric UX.
- Optional token circuit breaker with:
  - pre-flight soft check (`requestedTokens`)
  - post-call hard accounting (`reportUsage(tokens)`)
  - dev warning when `withKey` finishes without `reportUsage`.
- `nuke()` reset flow to clear encrypted key and session state.

## Why Use This

Most BYOK apps choose between two bad defaults:

- plaintext key entry in the browser (trust-killing UX), or
- rolling custom client-side crypto where implementation mistakes are common.

`byok-vault` is useful when you want browser-native key handling with opinionated defaults:

- encrypted-at-rest storage with per-key random salt and AES-GCM,
- scoped key access (`withKey`) instead of wide key plumbing through app code,
- built-in token budget circuit breaker (`requestedTokens` + `reportUsage`).

Use this if your threat model is client-side BYOK with passive exposure concerns.  
Do not use this as an active-XSS defense; use a server-side proxy for that.

## Why not use OpenRouter BYOK?

OpenRouter is a fantastic platform for LLM routing, and their Bring-Your-Own-Key feature is great if you want managed infrastructure. However, it is fundamentally a **server-side proxy**.

Use `byok-vault` instead of OpenRouter BYOK if you are building a **local-first** application and need:

1. **Zero Onboarding Friction:** OpenRouter BYOK requires your users to leave your app, create an OpenRouter account, paste their OpenAI/Anthropic key into OpenRouter's dashboard, generate a *new* proxy key, and paste that back into your app. With `byok-vault`, users paste their key directly into your app and start working immediately.
2. **Zero Middlemen:** OpenRouter requires users to store their API keys on OpenRouter's servers, and all API calls are routed through their backend. `byok-vault` keeps the key strictly inside the user's browser. It never touches a server.
3. **Zero Proxy Fees:** While OpenRouter offers a generous free tier for BYOK, high-volume apps eventually hit a 5% routing tax just to use their own keys. `byok-vault` talks directly to the LLM provider: no proxy, no tax.

## Install

```bash
npm install byok-vault
```

## Quick Start (Passphrase)

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

## Quick Start (Passkey)

```ts
import { BYOKVault } from "byok-vault";

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

### Optional: Token Budget (Circuit Breaker)

```ts
const vault = new BYOKVault({
  maxTokens: 30_000,
  hardMinTokens: 5_000,
  hardMaxTokens: 100_000
});

// user-selected runtime override (for example from a settings UI)
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
- In dev mode, vault warns if `withKey` returns successfully without `reportUsage`.
- `setMaxTokens(limit)` lets you adjust the active limit at runtime.
- `hardMinTokens` and `hardMaxTokens` enforce developer-defined bounds for runtime updates.

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

## Plaintext Key Migration

```ts
const legacyStorageKey = "openai_api_key";
const plainKey = localStorage.getItem(legacyStorageKey);

if (plainKey) {
  await vault.importKey(plainKey, userPassphrase, {
    clearStorageKey: legacyStorageKey
  });
}
```

Migration checklist:

1. Detect legacy plaintext key in storage.
2. Prompt user for passphrase.
3. Call `importKey(plainKey, passphrase)`.
4. Remove only legacy plaintext key storage.

If plaintext key is nested inside JSON config, extract only that field and keep the rest:

```ts
const configStorageKey = "model_settings";
const config = JSON.parse(localStorage.getItem(configStorageKey) ?? "{}");
if (typeof config.apiKey === "string" && config.apiKey.length > 0) {
  await vault.importKey(config.apiKey, userPassphrase);
  delete config.apiKey;
  localStorage.setItem(configStorageKey, JSON.stringify(config));
}
```

## Stream-Friendly Scope Pattern

```ts
await vault.withKeyScope(
  async () => streamProviderResponse(),
  {
    passphrase: userPassphrase,
    session: "action"
  }
);
```

`withKeyScope` keeps unlock state for the Promise lifetime of the callback. It does not turn the callback into an async generator context, so you cannot `yield` from inside that callback. For true streaming UIs, start the stream inside the scope and forward chunks outside it (for example through events/queue/state updates).

## React Helper Pattern

```tsx
function useVaultState(vault: BYOKVault) {
  const [state, setState] = useState(vault.getState());

  const refresh = useCallback(() => setState(vault.getState()), [vault]);

  const unlock = useCallback(
    async (passphrase: string, session: "tab" | "action" = "tab") => {
      await vault.unlock(passphrase, { session });
      refresh();
    },
    [vault, refresh]
  );

  const setConfig = useCallback(
    async (config: VaultConfig, passphrase: string) => {
      await vault.setConfig(config, passphrase);
      refresh();
    },
    [vault, refresh]
  );

  return { state, canCall: state === "unlocked", unlock, setConfig, refresh };
}
```

## API

```ts
new BYOKVault(options?)
```

Options:

- `namespace?: string` storage key prefix (default `byok-vault`)
- `minPassphraseLength?: number` default `8`
- `pbkdf2Iterations?: number` default `200000`
- `maxTokens?: number` enables circuit breaker
- `hardMinTokens?: number` default `1` when breaker is enabled
- `hardMaxTokens?: number` optional ceiling for `setMaxTokens(...)`
- `devMode?: boolean` defaults to `NODE_ENV !== "production"` when available
- `localStorage?: Storage` / `sessionStorage?: Storage` for testing/custom storage
- `logger?: { warn(message: string): void }` custom warning sink
- `passkeyAdapter?: PasskeyAdapter` optional WebAuthn adapter override (for custom environments/tests)
- `sessionMode?: "tab" | "action"` default unlock persistence mode (`tab` keeps session unlocked, `action` requires passphrase/passkey per action)

`hardMinTokens` / `hardMaxTokens` require `maxTokens` to be set.

Methods:

- `setKey(apiKey, passphrase): Promise<void>`
- `importKey(plainKey, passphrase, { clearStorageKey?, plainStorage? }?): Promise<void>`
- `setConfig(config, passphrase): Promise<void>`
- `setConfigWithPasskey(config, options): Promise<void>`
- `unlock(passphrase, { session? }): Promise<void>`
- `unlockWithPasskey({ timeoutMs?, session? }?): Promise<void>`
- `withKey(callback, { requestedTokens?, passphrase?, session? }): Promise<T>`
- `withConfig(callback, { requestedTokens?, passphrase?, session? }): Promise<T>`
- `withKeyScope(callback, { requestedTokens?, passphrase?, session? }): Promise<T>`
- `reportUsage(tokens): void`
- `getUsage(): number`
- `getRemainingTokens(): number`
- `getMaxTokens(): number | null`
- `setMaxTokens(limit): void`
- `getHardMinTokens(): number | null`
- `getHardMaxTokens(): number | null`
- `hasStoredKey(): boolean`
- `getState(): "none" | "locked" | "unlocked"`
- `canCall(): boolean`
- `isPasskeyEnrolled(): boolean`
- `isLocked(): boolean`
- `getEncryptedBlob(): EncryptedKeyBlob | null`
- `lock(): void`
- `nuke(): void`

`setKey` / `withKey` remain compatibility wrappers for key-only workflows.

## Threat Model and Limitations

- JavaScript cannot force immediate memory zeroization of strings; decrypted keys can remain in heap memory until GC.
- Passphrase quality matters. A short PIN (for example 4 digits) is brute-forceable even with high PBKDF2 iteration counts.
- PBKDF2 iteration count has a hard floor at `200000`; lower values throw at construction time.
- This package intentionally has zero runtime dependencies, but still has normal dev dependencies for build/test tooling.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run pack:check
npm run demo
```

## Sample Project (Gemini)

See `examples/local-first-byok-sample/README.md` for a separate sample app that uses this package with Gemini API calls.

## Human + LLM Docs

- Human integration guide: `docs/HUMANS.md`
- LLM reference: `docs/LLMS.md`
- LLM index file: `llms.txt`
