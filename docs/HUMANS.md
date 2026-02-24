# Human Docs: byok-vault

This guide is for developers integrating `byok-vault` into real apps.

## What This Library Solves

- Encrypts API credentials in-browser before writing to `localStorage`.
- Supports encrypted JSON config (`apiKey` plus metadata like org/model/base URL).
- Supports two unlock modes:
  - passphrase (`setConfig` + `unlock`)
  - passkey/WebAuthn (`setConfigWithPasskey` + `unlockWithPasskey`)
- Scopes decrypted access to one callback (`withConfig` / `withKey`).
- Adds optional per-session token budget tracking.

It is not a backend replacement for high-security threat models with active XSS risk.

## Quick Integration Checklist

1. Collect provider config (`apiKey`, optional metadata).
2. Choose unlock mode:
   - passphrase: `setConfig(config, passphrase)`
   - passkey: `setConfigWithPasskey(config, options)`
   - migration from plaintext key: `importKey(plainKey, passphrase, { clearStorageKey })`
3. Run provider calls inside `withConfig(...)` or `withKey(...)`.
4. If breaker enabled, call `reportUsage(tokens)` after each successful response.
5. Add reset UI with `nuke()` and optional session lock with `lock()`.
6. Prefer `getState()` / `canCall()` for gating UI and API calls.
7. Use `withKeyScope(...)` when your async flow needs unlock state across nested calls.

## Minimal Pattern (Passphrase)

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
  await fetch("/your-provider-call", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` }
  });
});
```

## Minimal Pattern (Passkey)

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
    userName: currentUserEmail
  }
);

vault.lock();
await vault.unlockWithPasskey();
```

## UX Recommendations

- Show one clear choice: unlock with passphrase or unlock with passkey.
- If passkey is unavailable, keep passphrase fallback visible.
- Pick a session strategy: `tab` for smoother UX, `action` for stricter re-auth prompts.
- Explain limits clearly: this protects data at rest, not active in-origin XSS.
- If breaker is enabled, display usage and remaining tokens.
- Provide visible controls for `lock()` and `nuke()`.

## Security Boundaries (Plain English)

- `sessionStorage` caching is convenience only, not stronger security.
- If hostile JS executes in your origin, it can still intercept keys in-flight.
- Decrypted strings can remain in JS memory until garbage collection.
- This package is not formally audited.

## Error Handling You Should Surface

- `PASSPHRASE_POLICY`
- `WRONG_PASSPHRASE`
- `VAULT_LOCKED`
- `PASSKEY_NOT_SUPPORTED`
- `PASSKEY_NOT_ENROLLED`
- `PASSKEY_UNLOCK_FAILED`
- `CIRCUIT_BREAKER_LIMIT`
- `KEY_NOT_FOUND`

## Production Readiness Checklist

- Add CSP and strict input sanitization in your app.
- Instrument `reportUsage` code path and alert on missing usage reporting.
- Use CI checks (`typecheck`, `test`, `pack:check`) before release.
- Document your app threat model in product copy.
