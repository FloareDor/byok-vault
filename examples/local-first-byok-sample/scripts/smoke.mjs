import { webcrypto } from "node:crypto";

import { BYOKVault, CircuitBreakerLimitError } from "byok-browser-vault";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true
  });
}

class MemoryStorage {
  #map = new Map();

  get length() {
    return this.#map.size;
  }

  clear() {
    this.#map.clear();
  }

  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }

  key(index) {
    return Array.from(this.#map.keys())[index] ?? null;
  }

  removeItem(key) {
    this.#map.delete(key);
  }

  setItem(key, value) {
    this.#map.set(String(key), String(value));
  }
}

const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();

const vault = new BYOKVault({
  namespace: "sample-smoke",
  maxTokens: 100,
  devMode: false,
  localStorage,
  sessionStorage
});

await vault.setKey("sk-smoke", "sample-passphrase-123");

const key = await vault.withKey(async (decrypted) => {
  vault.reportUsage(60);
  return decrypted;
});

if (key !== "sk-smoke") {
  throw new Error(`Expected decrypted key to round-trip; got "${key}".`);
}

let blocked = false;
try {
  await vault.withKey(
    async () => {
      throw new Error("should not reach callback when pre-flight fails");
    },
    { requestedTokens: 50 }
  );
} catch (error) {
  if (error instanceof CircuitBreakerLimitError) {
    blocked = true;
  } else {
    throw error;
  }
}

if (!blocked) {
  throw new Error("Expected circuit breaker to block request at 60 + 50 > 100.");
}

const encrypted = localStorage.getItem("sample-smoke:encrypted-key") ?? "";
if (encrypted.includes("sk-smoke")) {
  throw new Error("Encrypted storage unexpectedly contains plaintext key.");
}

const liveGeminiKey = process.env.GEMINI_API_KEY?.trim();
if (liveGeminiKey) {
  const liveLocalStorage = new MemoryStorage();
  const liveSessionStorage = new MemoryStorage();
  const liveVault = new BYOKVault({
    namespace: "sample-smoke-live",
    maxTokens: 1000,
    devMode: false,
    localStorage: liveLocalStorage,
    sessionStorage: liveSessionStorage
  });

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
  const prompt = process.env.GEMINI_PROMPT?.trim() || "Return one short sentence about secure BYOK UX.";

  await liveVault.setKey(liveGeminiKey, "sample-live-passphrase-123");

  const liveResult = await liveVault.withKey(
    async (key) => {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model
        )}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        }
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(
          `Gemini API ${response.status}: ${body?.error?.message || response.statusText}`
        );
      }

      const totalTokens = Number(body?.usageMetadata?.totalTokenCount ?? 0);
      liveVault.reportUsage(Number.isFinite(totalTokens) && totalTokens >= 0 ? totalTokens : 0);

      const text = (body?.candidates?.[0]?.content?.parts ?? [])
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("\n")
        .trim();

      return {
        text,
        totalTokens: Number.isFinite(totalTokens) && totalTokens >= 0 ? totalTokens : 0
      };
    },
    { requestedTokens: 150 }
  );

  console.log(
    JSON.stringify(
      {
        gemini: "ok",
        model,
        tokens: liveResult.totalTokens,
        textPreview: liveResult.text.slice(0, 80)
      },
      null,
      2
    )
  );
} else {
  console.log("Gemini live check skipped. Set GEMINI_API_KEY to run a real Gemini call.");
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      usage: vault.getUsage(),
      remaining: vault.getRemainingTokens()
    },
    null,
    2
  )
);
