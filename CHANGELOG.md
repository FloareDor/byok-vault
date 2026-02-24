# Changelog

All notable changes to this project will be documented in this file.

## 0.2.1 - 2026-02-24

### Fixed
- Regenerated published `dist` artifacts to match documented and implemented APIs, including:
  - `getState()`
  - `canCall()`
  - `importKey()`
  - `withKeyScope()`
  - `sessionMode` option support
- Updated exported runtime surface and TypeScript declarations to include passkey and session-related symbols.

### Added
- API parity guard script (`scripts/check-api-parity.mjs`) to verify release consistency across:
  - runtime exports (`dist/index.js`)
  - type exports (`dist/index.d.ts`, `dist/vault.d.ts`)
  - README API contract
- `prepack` safeguard to force build and API parity validation before `npm pack`/publish.
- Improved pack check parsing to handle `prepack` log output before JSON.

### Documentation
- Clarified `withKeyScope(...)` semantics as Promise-lifetime scope (not async-generator `yield` scope).
- Added plaintext migration checklist from legacy plaintext key storage.
- Added JSON-embedded key migration note (`{ provider, apiKey }` style configs).
- Added React helper pattern (`useVaultState`) for `state`/`canCall`/`unlock`/`setConfig` flows.
- Updated docs-site API reference to include new and session-aware signatures.
