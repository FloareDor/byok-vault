import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function assertContains(text, needle, context) {
  if (!text.includes(needle)) {
    throw new Error(`Missing ${context}: ${needle}`);
  }
}

function main() {
  const distIndexJs = read("dist/index.js");
  const distIndexDts = read("dist/index.d.ts");
  const distVaultDts = read("dist/vault.d.ts");
  const readme = read("README.md");

  const runtimeExports = [
    "deriveKeyBitsFromSecret",
    "encryptConfigWithPasskeyMaterial",
    "BrowserPasskeyAdapter",
    "createBrowserPasskeyAdapter",
    "PasskeyNotEnrolledError",
    "PasskeyNotSupportedError",
    "PasskeyUnlockFailedError"
  ];

  const typeExports = [
    "ImportKeyOptions",
    "SetConfigWithPasskeyOptions",
    "UnlockWithPasskeyOptions",
    "VaultSessionMode",
    "VaultState",
    "PasskeyAdapter"
  ];

  const vaultMethodSignatures = [
    "importKey(plainKey: string, passphrase: string, options?: ImportKeyOptions): Promise<void>;",
    "withKeyScope<T>(callback: () => Promise<T> | T, options?: WithKeyOptions): Promise<T>;",
    "getState(): VaultState;",
    "canCall(): boolean;"
  ];

  const readmeMethods = [
    "- `importKey(plainKey, passphrase, { clearStorageKey?, plainStorage? }?): Promise<void>`",
    "- `withKeyScope(callback, { requestedTokens?, passphrase?, session? }): Promise<T>`",
    "- `getState(): \"none\" | \"locked\" | \"unlocked\"`",
    "- `canCall(): boolean`",
    "- `sessionMode?: \"tab\" | \"action\"`"
  ];

  for (const symbol of runtimeExports) {
    assertContains(distIndexJs, symbol, "runtime export");
  }
  for (const symbol of typeExports) {
    assertContains(distIndexDts, symbol, "type export");
  }
  for (const signature of vaultMethodSignatures) {
    assertContains(distVaultDts, signature, "vault type method");
  }
  for (const readmeMethod of readmeMethods) {
    assertContains(readme, readmeMethod, "README API entry");
  }

  console.log("API parity check passed.");
}

main();
