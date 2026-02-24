---
name: API parity regression
about: Report mismatch between README/docs, runtime exports, and TypeScript declarations
title: "[API parity] "
labels: ["bug", "api-contract"]
assignees: []
---

## Summary

Describe the mismatch clearly.

## Package Version

- byok-vault version:
- Node version:
- Browser/runtime:

## Expected (docs/README)

List the documented methods/options/types you expected.

## Actual (installed package)

List what is missing or mismatched in:
- Runtime exports
- `dist/index.d.ts` / `dist/vault.d.ts`
- Behavior

## Reproduction

```ts
import { BYOKVault } from "byok-vault";

const vault = new BYOKVault();
console.log(typeof vault.getState);
console.log(typeof vault.canCall);
console.log(typeof vault.importKey);
console.log(typeof vault.withKeyScope);
```

## Verification Checklist

- [ ] `npm run build`
- [ ] `npm run test`
- [ ] `npm run pack:check`
- [ ] `npm run api:check`

## Additional Context

Include screenshots, logs, or snippets of generated `dist/*` files if helpful.
