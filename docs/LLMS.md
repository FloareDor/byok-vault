# LLM Docs: byok-browser-vault

This file is a machine-oriented reference for code assistants and agents.

## Package Identity

- Name: `byok-browser-vault`
- Runtime deps: none
- Environment: browser Web Crypto API (`crypto.subtle`), `localStorage`, `sessionStorage`
- Primary class: `BYOKVault`

## Core Guarantees

- Stored API keys are encrypted at rest using AES-GCM.
- Per-key salt is random and unique per encryption operation.
- AES key material is derived via PBKDF2 (SHA-256), default and enforced floor: `200000` iterations.
- Decrypted key is only provided inside `withKey(callback)`.

## Non-Goals / Limits

- No defense against active XSS in same origin.
- No hard provider SDK integrations.
- No authoritative token accounting without `reportUsage(tokens)`.

## Canonical API Contracts

### Constructor

```ts
new BYOKVault(options?)
```

Important options:

- `namespace?: string` -> storage key prefix
- `minPassphraseLength?: number` -> integer >= 1 (default 8)
- `pbkdf2Iterations?: number` -> integer >= 200000
- `maxTokens?: number` -> enables circuit breaker if set
- `devMode?: boolean`
- `localStorage?: Storage`, `sessionStorage?: Storage`
- `logger?: { warn(message: string): void }`

### Methods

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

## Circuit Breaker Semantics

- `requestedTokens` is pre-flight estimate only.
- `reportUsage(tokens)` is post-call hard accounting.
- Breaker blocks the next request when usage already at/over budget.
- In dev mode, warning is emitted if `withKey` returns successfully without `reportUsage`.
- If callback throws, missing `reportUsage` warning is not emitted.

## Error Codes

- `PASSPHRASE_POLICY`
- `PBKDF2_POLICY`
- `KEY_NOT_FOUND`
- `VAULT_LOCKED`
- `WRONG_PASSPHRASE`
- `INVALID_USAGE_REPORT`
- `CIRCUIT_BREAKER_LIMIT`
- `CIRCUIT_BREAKER_DISABLED`

## Correct Usage Pattern (Agent Guidance)

1. Construct `BYOKVault`.
2. Save key once via `setKey(...)`.
3. Use `withKey(...)` around each provider call.
4. Parse provider usage from response and call `reportUsage(tokens)` if breaker enabled.
5. Use `nuke()` for full reset; use `lock()` for session-only lock.

## Anti-Patterns (Do Not Generate)

- Do not store plaintext API keys in storage.
- Do not call `withKey` and omit `reportUsage` when `maxTokens` is configured.
- Do not claim this library mitigates active XSS.
- Do not set `pbkdf2Iterations < 200000`.

## Provider Usage Parsing Examples

OpenAI style:

```ts
const tokens = response.usage?.total_tokens ?? 0;
vault.reportUsage(tokens);
```

Anthropic style:

```ts
const tokens =
  (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
vault.reportUsage(tokens);
```

Gemini style:

```ts
const tokens = response.usageMetadata?.totalTokenCount ?? 0;
vault.reportUsage(tokens);
```
