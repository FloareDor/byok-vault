# LLM Docs: byok-vault

Machine-oriented reference for code assistants and agents.

## Package Identity

- Name: `byok-vault`
- Runtime deps: none
- Environment: browser Web Crypto API (`crypto.subtle`), `localStorage`, `sessionStorage`
- Primary class: `BYOKVault`

## Core Guarantees

- API credential material is encrypted at rest using AES-GCM.
- Config payload can be key-only (`setKey`) or JSON config (`setConfig`).
- Passphrase mode uses PBKDF2 (SHA-256), default and enforced floor: `200000`.
- Passkey mode can unlock using WebAuthn PRF-backed secret derivation.
- Decrypted material is exposed only in scoped callbacks (`withConfig` / `withKey`).

## Limits / Non-Goals

- No defense against active XSS in same origin.
- No hard provider SDK integrations.
- No authoritative token accounting without `reportUsage(tokens)`.

## Canonical API Contracts

### Constructor

```ts
new BYOKVault(options?)
```

Important options:

- `namespace?: string`
- `minPassphraseLength?: number` (integer >= 1, default `8`)
- `pbkdf2Iterations?: number` (integer >= `200000`)
- `maxTokens?: number` (enables breaker)
- `hardMinTokens?: number` (default `1` when breaker enabled)
- `hardMaxTokens?: number`
- `devMode?: boolean`
- `localStorage?: Storage`
- `sessionStorage?: Storage`
- `passkeyAdapter?: PasskeyAdapter`
- `logger?: { warn(message: string): void }`
- `sessionMode?: "tab" | "action"`

`hardMinTokens` / `hardMaxTokens` require `maxTokens`.

### Methods

- `setKey(apiKey, passphrase): Promise<void>`
- `importKey(plainKey, passphrase, { clearStorageKey?, plainStorage? }?): Promise<void>`
- `setConfig(config, passphrase): Promise<void>`
- `setConfigWithPasskey(config, options): Promise<void>`
- `unlock(passphrase, { session? }?): Promise<void>`
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

## Circuit Breaker Semantics

- `requestedTokens` is pre-flight estimate only.
- `reportUsage(tokens)` is post-call hard accounting.
- Breaker blocks next request when usage is already at/over budget.
- Runtime budget changes use `setMaxTokens(...)`.
- Runtime changes are bounded by `hardMinTokens` / `hardMaxTokens` when configured.
- Dev warning emitted if `withKey`/`withConfig` completes without `reportUsage`.

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

## Correct Usage Pattern (Agent Guidance)

1. Construct `BYOKVault`.
2. Persist config with one mode:
   - passphrase: `setConfig(...)`
   - passkey: `setConfigWithPasskey(...)`
3. Unlock with matching mode (`unlock` or `unlockWithPasskey`) as needed.
4. Call providers inside `withConfig` (or `withKey` for key-only code).
5. Call `reportUsage(tokens)` when breaker is enabled.
6. Use `lock()` for session lock and `nuke()` for full reset.
7. Prefer `getState()` for UI gate logic (`none` -> setup, `locked` -> unlock, `unlocked` -> app).

## Anti-Patterns (Do Not Generate)

- Do not store plaintext API keys in storage.
- Do not use `unlock(passphrase)` for passkey-enrolled vault blobs.
- Do not call `withKey`/`withConfig` and omit `reportUsage` when breaker enabled.
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
