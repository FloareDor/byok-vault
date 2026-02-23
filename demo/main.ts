import { BYOKVault, BYOKVaultError } from "../src/index.js";

import "./style.css";

const NAMESPACE = "byok-vault-demo";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root.");
}

function must<T>(value: T | null, message: string): T {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

app.innerHTML = `
  <main class="shell">
    <h1 class="title">BYOK Browser Vault Demo</h1>
    <p class="subtitle">Dummy keys only. This demo simulates API calls and token accounting.</p>

    <section class="grid">
      <article class="card stack">
        <h2>Vault Controls</h2>
        <label>
          Passphrase
          <input id="passphrase" type="password" placeholder="8+ characters" value="demo-passphrase-123" />
        </label>
        <label>
          Dummy API Key
          <input id="apiKey" type="text" placeholder="sk-demo-..." value="sk-demo-not-real" />
        </label>
        <label>
          Max Tokens (Session)
          <input id="maxTokens" type="number" min="1" step="1" value="1200" />
        </label>
        <div class="row">
          <button id="applyLimit" class="secondary" type="button">Apply Limit</button>
          <button id="saveKey" class="primary" type="button">Save Encrypted Key</button>
          <button id="unlock" class="secondary" type="button">Unlock</button>
          <button id="nuke" class="danger" type="button">Nuke Vault</button>
        </div>
      </article>

      <article class="card stack">
        <h2>Circuit Breaker</h2>
        <label>
          Requested Tokens (pre-flight estimate)
          <input id="requestedTokens" type="number" min="0" step="1" value="250" />
        </label>
        <div class="row">
          <button id="runRequest" class="primary" type="button">Run Simulated Request</button>
          <button id="runNoReport" class="secondary" type="button">Run Without reportUsage</button>
        </div>
        <div class="stats">
          <div class="stat"><span>Usage</span><strong id="usage">0</strong></div>
          <div class="stat"><span>Remaining</span><strong id="remaining">0</strong></div>
          <div class="stat"><span>Locked</span><strong id="locked">true</strong></div>
        </div>
      </article>

      <article class="card stack">
        <h2>Stored Ciphertext Blob</h2>
        <pre id="blobView">(empty)</pre>
      </article>

      <article class="card stack">
        <h2>Event Log</h2>
        <ul id="log" class="log"></ul>
      </article>
    </section>
  </main>
`;

const passphraseInput = must(
  app.querySelector<HTMLInputElement>("#passphrase"),
  "Missing passphrase input."
);
const apiKeyInput = must(
  app.querySelector<HTMLInputElement>("#apiKey"),
  "Missing api key input."
);
const maxTokensInput = must(
  app.querySelector<HTMLInputElement>("#maxTokens"),
  "Missing max tokens input."
);
const requestedTokensInput = must(
  app.querySelector<HTMLInputElement>("#requestedTokens"),
  "Missing requested tokens input."
);
const usageNode = must(app.querySelector<HTMLElement>("#usage"), "Missing usage node.");
const remainingNode = must(
  app.querySelector<HTMLElement>("#remaining"),
  "Missing remaining node."
);
const lockedNode = must(app.querySelector<HTMLElement>("#locked"), "Missing locked node.");
const blobNode = must(app.querySelector<HTMLElement>("#blobView"), "Missing blob node.");
const logNode = must(app.querySelector<HTMLUListElement>("#log"), "Missing log node.");
const applyLimitButton = must(
  app.querySelector<HTMLButtonElement>("#applyLimit"),
  "Missing apply limit button."
);
const saveKeyButton = must(
  app.querySelector<HTMLButtonElement>("#saveKey"),
  "Missing save key button."
);
const unlockButton = must(
  app.querySelector<HTMLButtonElement>("#unlock"),
  "Missing unlock button."
);
const runRequestButton = must(
  app.querySelector<HTMLButtonElement>("#runRequest"),
  "Missing run request button."
);
const runNoReportButton = must(
  app.querySelector<HTMLButtonElement>("#runNoReport"),
  "Missing run without report button."
);
const nukeButton = must(
  app.querySelector<HTMLButtonElement>("#nuke"),
  "Missing nuke button."
);

let vault = createVault(readMaxTokens());

function createVault(maxTokens: number): BYOKVault {
  return new BYOKVault({
    namespace: NAMESPACE,
    maxTokens,
    devMode: true,
    logger: {
      warn: (message: string) => {
        appendLog(`warn: ${message}`, "error");
      }
    }
  });
}

function readMaxTokens(): number {
  const parsed = Number.parseInt(maxTokensInput.value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1200;
}

function readRequestedTokens(): number {
  const parsed = Number.parseInt(requestedTokensInput.value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function appendLog(message: string, kind: "info" | "error" = "info"): void {
  const item = document.createElement("li");
  item.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  if (kind === "error") {
    item.classList.add("error");
  }
  logNode.prepend(item);
  if (logNode.children.length > 40) {
    logNode.removeChild(logNode.lastChild as Node);
  }
}

function refreshView(): void {
  usageNode.textContent = String(vault.getUsage());
  const remaining = vault.getRemainingTokens();
  remainingNode.textContent = Number.isFinite(remaining) ? String(remaining) : "inf";
  lockedNode.textContent = String(vault.isLocked());

  const blob = vault.getEncryptedBlob();
  blobNode.textContent = blob ? JSON.stringify(blob, null, 2) : "(empty)";
}

async function simulatedProviderRequest(
  key: string,
  requestedTokens: number
): Promise<{ usage: { total_tokens: number }; keyPreview: string }> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  const multiplier = 0.85 + Math.random() * 0.2;
  const total = Math.max(1, Math.round(requestedTokens * multiplier));
  return {
    usage: { total_tokens: total },
    keyPreview: `${key.slice(0, 4)}...${key.slice(-2)}`
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof BYOKVaultError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

applyLimitButton.addEventListener("click", () => {
  vault = createVault(readMaxTokens());
  appendLog(`applied max token limit: ${vault.getMaxTokens() ?? "none"}`);
  refreshView();
});

saveKeyButton.addEventListener("click", async () => {
  try {
    await vault.setKey(apiKeyInput.value, passphraseInput.value);
    appendLog("stored encrypted key in localStorage and cached derived key in session");
  } catch (error) {
    appendLog(toErrorMessage(error), "error");
  }
  refreshView();
});

unlockButton.addEventListener("click", async () => {
  try {
    await vault.unlock(passphraseInput.value);
    appendLog("vault unlocked for this tab session");
  } catch (error) {
    appendLog(toErrorMessage(error), "error");
  }
  refreshView();
});

runRequestButton.addEventListener("click", async () => {
  const requestedTokens = readRequestedTokens();
  try {
    await vault.withKey(
      async (key) => {
        const response = await simulatedProviderRequest(key, requestedTokens);
        vault.reportUsage(response.usage.total_tokens);
        appendLog(
          `request ok (${response.usage.total_tokens} tokens, key ${response.keyPreview})`
        );
      },
      { requestedTokens }
    );
  } catch (error) {
    appendLog(toErrorMessage(error), "error");
  }
  refreshView();
});

runNoReportButton.addEventListener("click", async () => {
  const requestedTokens = readRequestedTokens();
  try {
    await vault.withKey(
      async (key) => {
        const response = await simulatedProviderRequest(key, requestedTokens);
        appendLog(
          `request finished without reportUsage (${response.usage.total_tokens} tokens estimated)`
        );
      },
      { requestedTokens }
    );
  } catch (error) {
    appendLog(toErrorMessage(error), "error");
  }
  refreshView();
});

nukeButton.addEventListener("click", () => {
  vault.nuke();
  appendLog("nuke completed: encrypted key, session cache, and usage were cleared");
  refreshView();
});

appendLog("demo ready");
refreshView();
