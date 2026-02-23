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

