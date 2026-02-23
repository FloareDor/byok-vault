# Human Docs: byok-browser-vault

This guide is for developers integrating `byok-browser-vault` into real apps.

## What This Library Solves

- Encrypts user API keys in-browser before writing to `localStorage`.
- Lets you scope decrypted key access to one callback with `withKey(...)`.
- Adds optional per-session token budget tracking via a circuit breaker.

It is not a backend replacement for high-security threat models with active XSS risk.

## Quick Integration Checklist

1. Ask user for API key and passphrase.
2. Save once with `await vault.setKey(apiKey, passphrase)`.
3. For each request, call `vault.withKey(...)`.
4. If breaker enabled, call `vault.reportUsage(tokens)` after each successful provider response.
5. Add reset UI that calls `vault.nuke()`.

## Minimal Usage Pattern

```ts
import { BYOKVault } from "byok-browser-vault";

const vault = new BYOKVault({
  maxTokens: 30_000
});

await vault.setKey(userApiKey, userPassphrase);

await vault.withKey(
  async (key) => {
    const response = await fetch("/your-provider-call", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` }
    }).then((r) => r.json());

    const used = response.usage?.total_tokens ?? 0;
    vault.reportUsage(used);
  },
  { requestedTokens: 1200 }
);
```

## UX Recommendations

- Explain passphrase purpose clearly: protects key at rest in browser storage.
- Enforce strong passphrase UX (default floor is 8 chars, consider stronger copy and meter).
- Show current token usage and remaining budget if breaker is enabled.
- Provide a visible "reset vault" control wired to `nuke()`.

## Security Boundaries (Plain English)

- `sessionStorage` caching is convenience only, not stronger security.
- If hostile JS executes in your origin, it can still intercept keys in-flight.
- Decrypted strings can remain in JS memory until garbage collection.
- This package is not formally audited.

## Common Mistakes

- Enabling `maxTokens` but forgetting `reportUsage(tokens)`.
- Treating `requestedTokens` pre-flight as exact accounting.
- Assuming this protects against active XSS.
- Lowering PBKDF2 iterations below `200000` (constructor throws).

## Error Handling You Should Surface

- `PASSPHRASE_POLICY`: passphrase too short.
- `WRONG_PASSPHRASE`: user entered incorrect passphrase.
- `VAULT_LOCKED`: no cached session key and no passphrase provided.
- `CIRCUIT_BREAKER_LIMIT`: budget exhausted/pre-flight blocked.
- `KEY_NOT_FOUND`: no stored key yet.

## Production Readiness Checklist

- Add CSP and strict input sanitization in your app to reduce XSS risk.
- Instrument `reportUsage` code path and alert on missing usage reporting.
- Use `pack:check` and CI before publishing changes.
- Document threat model to users in product copy.
