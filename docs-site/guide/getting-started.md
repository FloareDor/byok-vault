# Getting Started

## Install

```bash
npm install byok-vault
```

## Basic Usage

```ts
import { BYOKVault } from "byok-vault";

const vault = new BYOKVault();

await vault.setKey(userApiKey, userPassphrase);

await vault.withKey(async (key) => {
  await fetch("https://api.example.com/llm", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt: "hello" })
  });
});
```

## Typical Flow

1. Ask user for API key and passphrase.
2. Save once with `setKey`.
3. Use `withKey` for each provider call.
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
