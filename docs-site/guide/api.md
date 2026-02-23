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
