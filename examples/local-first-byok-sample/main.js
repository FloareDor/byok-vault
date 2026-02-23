import { BYOKVault, BYOKVaultError } from "byok-browser-vault";

const namespace = "local-first-byok-sample";

const passphraseInput = document.querySelector("#passphrase");
const apiKeyInput = document.querySelector("#apiKey");
const maxTokensInput = document.querySelector("#maxTokens");
const requestedTokensInput = document.querySelector("#requestedTokens");
const modelInput = document.querySelector("#model");
const promptInput = document.querySelector("#prompt");
const usageNode = document.querySelector("#usage");
const remainingNode = document.querySelector("#remaining");
const lockedNode = document.querySelector("#locked");
const blobNode = document.querySelector("#blob");
const responseNode = document.querySelector("#response");
const eventsNode = document.querySelector("#events");

const applyLimitButton = document.querySelector("#applyLimit");
const saveKeyButton = document.querySelector("#saveKey");
const unlockButton = document.querySelector("#unlock");
const nukeButton = document.querySelector("#nuke");
const simulateButton = document.querySelector("#simulate");
const skipReportButton = document.querySelector("#skipReport");

function must(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

const passphraseEl = must(passphraseInput, "Missing passphrase input.");
const apiKeyEl = must(apiKeyInput, "Missing API key input.");
const maxTokensEl = must(maxTokensInput, "Missing max tokens input.");
const requestedTokensEl = must(requestedTokensInput, "Missing requested tokens input.");
const modelEl = must(modelInput, "Missing model input.");
const promptEl = must(promptInput, "Missing prompt input.");
const usageEl = must(usageNode, "Missing usage node.");
const remainingEl = must(remainingNode, "Missing remaining node.");
const lockedEl = must(lockedNode, "Missing locked node.");
const blobEl = must(blobNode, "Missing blob node.");
const responseEl = must(responseNode, "Missing response node.");
const eventsEl = must(eventsNode, "Missing events list.");

const applyLimitEl = must(applyLimitButton, "Missing apply limit button.");
const saveKeyEl = must(saveKeyButton, "Missing save key button.");
const unlockEl = must(unlockButton, "Missing unlock button.");
const nukeEl = must(nukeButton, "Missing nuke button.");
const simulateEl = must(simulateButton, "Missing simulate button.");
const skipReportEl = must(skipReportButton, "Missing skip report button.");

let vault = createVault(readMaxTokens());

function createVault(maxTokens) {
  return new BYOKVault({
    namespace,
    maxTokens,
    devMode: true,
    logger: {
      warn: (message) => addEvent(`warn: ${message}`, true)
    }
  });
}

function readMaxTokens() {
  const parsed = Number.parseInt(maxTokensEl.value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
}

function readRequestedTokens() {
  const parsed = Number.parseInt(requestedTokensEl.value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function addEvent(text, isError = false) {
  const item = document.createElement("li");
  item.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  if (isError) {
    item.style.borderColor = "#dd8f7f";
    item.style.color = "#a62f2f";
  }
  eventsEl.prepend(item);
  if (eventsEl.children.length > 28) {
    eventsEl.removeChild(eventsEl.lastChild);
  }
}

function render() {
  usageEl.textContent = String(vault.getUsage());
  const remaining = vault.getRemainingTokens();
  remainingEl.textContent = Number.isFinite(remaining) ? String(remaining) : "inf";
  lockedEl.textContent = String(vault.isLocked());
  const blob = vault.getEncryptedBlob();
  blobEl.textContent = blob ? JSON.stringify(blob, null, 2) : "(empty)";
}

async function fakeProviderCall(key, requestedTokens) {
  const model = modelEl.value.trim() || "gemini-2.0-flash";
  const prompt = promptEl.value.trim();
  if (!prompt) {
    throw new Error("Prompt is required.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ]
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    const details = payload?.error?.message || response.statusText;
    throw new Error(`Gemini API ${response.status}: ${details}`);
  }

  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
  const usage = Number(payload?.usageMetadata?.totalTokenCount ?? requestedTokens ?? 0);

  return {
    usage: {
      total_tokens: Number.isFinite(usage) && usage >= 0 ? usage : 0
    },
    keyHint: `${key.slice(0, 4)}...${key.slice(-2)}`,
    text: text || "(no text returned)"
  };
}

function toMessage(error) {
  if (error instanceof BYOKVaultError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

applyLimitEl.addEventListener("click", () => {
  vault = createVault(readMaxTokens());
  addEvent(`max token budget set to ${vault.getMaxTokens()}`);
  render();
});

saveKeyEl.addEventListener("click", async () => {
  try {
    await vault.setKey(apiKeyEl.value, passphraseEl.value);
    addEvent("encrypted key saved to localStorage");
  } catch (error) {
    addEvent(toMessage(error), true);
  }
  render();
});

unlockEl.addEventListener("click", async () => {
  try {
    await vault.unlock(passphraseEl.value);
    addEvent("vault unlocked for this tab");
  } catch (error) {
    addEvent(toMessage(error), true);
  }
  render();
});

simulateEl.addEventListener("click", async () => {
  const requestedTokens = readRequestedTokens();
  try {
    await vault.withKey(
      async (key) => {
        const response = await fakeProviderCall(key, requestedTokens);
        vault.reportUsage(response.usage.total_tokens);
        responseEl.textContent = response.text;
        addEvent(
          `Gemini call succeeded (${response.usage.total_tokens} tokens, key ${response.keyHint})`
        );
      },
      { requestedTokens, passphrase: passphraseEl.value }
    );
  } catch (error) {
    addEvent(toMessage(error), true);
  }
  render();
});

skipReportEl.addEventListener("click", async () => {
  const requestedTokens = readRequestedTokens();
  try {
    await vault.withKey(
      async (key) => {
        const response = await fakeProviderCall(key, requestedTokens);
        responseEl.textContent = response.text;
        addEvent(
          `Gemini call done without reportUsage (${response.usage.total_tokens} tokens, key ${response.keyHint})`
        );
      },
      { requestedTokens, passphrase: passphraseEl.value }
    );
  } catch (error) {
    addEvent(toMessage(error), true);
  }
  render();
});

nukeEl.addEventListener("click", () => {
  vault.nuke();
  addEvent("vault nuked: encrypted blob, session cache, usage reset");
  render();
});

addEvent("sample app ready");
render();
