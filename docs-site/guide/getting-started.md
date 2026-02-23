# Getting Started

## Install

```bash
npm install byok-vault
```

## Basic Usage

```ts
import { BYOKVault } from "byok-vault";

const vault = new BYOKVault({
  maxTokens: 30_000,
  minPassphraseLength: 8
});

await vault.setKey(userApiKey, userPassphrase);
await vault.unlock(userPassphrase);

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
  { requestedTokens: 1200 }
);
```

## Typical Flow

1. Ask user for API key and passphrase.
2. Save once with `setKey`.
3. Use `withKey` for each provider call.
4. Call `reportUsage(tokens)` after each successful response.
5. Let user reset with `nuke()`.

