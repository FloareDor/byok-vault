---
layout: home

hero:
  name: byok-vault
  text: Browser BYOK Vault
  tagline: Keep user API keys encrypted in browser storage.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/FloareDor/byok-vault

features:
  - title: Encrypted at Rest
    details: API keys are encrypted with AES-GCM before saving to localStorage.
  - title: Scoped Key Access
    details: Use withKey(callback) so decrypted key access is short and explicit.
  - title: Token Circuit Breaker
    details: Optional max token budget with pre-check and usage reporting.
---

Building serverless AI apps usually means choosing between two awkward options: adding a backend only to hide API keys, or collecting raw keys in plaintext UX.

`byok-vault` keeps keys in the browser, encrypted at rest with a user passphrase, decrypts only for the narrow `withKey(...)` execution scope, and includes an optional token circuit breaker so apps cannot silently run away on usage.

## Security Reality Check (Read First)

- byok-vault is not a defense against active in-origin script injection (XSS).
- It does protect against passive exposure patterns like plaintext storage and accidental key handling.
- If your threat model requires active injection resistance, use a server-side proxy.

See the full threat model in [Security](./guide/security).
