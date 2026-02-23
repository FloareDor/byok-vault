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

