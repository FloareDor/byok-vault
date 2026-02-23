# Getting Started

## Install

```bash
npm install byok-vault
```

## Basic Usage (Passphrase)

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
  await fetch("https://api.example.com/llm", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt: "hello" })
  });
});
```

## Optional: Passkey Unlock (WebAuthn)

```ts
const vault = new BYOKVault();

await vault.setConfigWithPasskey(
  {
    apiKey: userApiKey,
    provider: "openai"
  },
  {
    rpName: "Your App Name",
    userName: currentUser.email
  }
);

vault.lock();
await vault.unlockWithPasskey();
```

## Typical Flow

1. Ask user for API config (`apiKey` plus optional metadata).
2. Choose unlock mode:
   - passphrase: `setConfig(...)`
   - passkey: `setConfigWithPasskey(...)`
3. Use `withConfig` (or `withKey`) for each provider call.
4. Let user reset with `nuke()`.

::: details Optional: Add Token Budget (Circuit Breaker)

```ts
const vault = new BYOKVault({
  maxTokens: 30_000,
  hardMinTokens: 5_000,
  hardMaxTokens: 100_000
});

// optional: apply user-selected budget inside developer bounds
vault.setMaxTokens(50_000);

await vault.withKey(
  async (key) => {
    const response = await fetch("https://api.example.com/llm", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt: "hello" })
    }).then((r) => r.json());

    const used = response.usage?.total_tokens ?? 0;
    vault.reportUsage(used);
  },
  {
    requestedTokens: 1200
  }
);
```

Only use this when you want per-session token limits. Runtime overrides are
available via `setMaxTokens(...)` and constrained by optional hard bounds.
:::
