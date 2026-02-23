import { describe, expect, it, vi } from "vitest";

import {
  BYOKVault,
  CircuitBreakerDisabledError,
  CircuitBreakerLimitError,
  decryptKey,
  encryptKey,
  KeyNotFoundError,
  PBKDF2PolicyError,
  VaultLockedError,
  WrongPassphraseError
} from "../src/index.js";

const API_KEY = "sk-test-do-not-use";
const PASSPHRASE = "correct horse battery staple";

function uniqueNamespace(prefix: string): string {
  const random = Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

describe("BYOKVault", () => {
  it("stores only ciphertext in localStorage", async () => {
    const namespace = uniqueNamespace("encrypted-storage");
    const vault = new BYOKVault({ namespace, devMode: true });

    await vault.setKey(API_KEY, PASSPHRASE);

    const raw = localStorage.getItem(`${namespace}:encrypted-key`);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain(API_KEY);
    const blob = JSON.parse(raw ?? "{}");
    expect(blob.ciphertext).toBeTypeOf("string");
    expect(blob.iv).toBeTypeOf("string");
    expect(blob.salt).toBeTypeOf("string");
  });

  it("fails gracefully for wrong passphrase", async () => {
    const namespace = uniqueNamespace("wrong-passphrase");
    const firstVault = new BYOKVault({ namespace, devMode: true });
    await firstVault.setKey(API_KEY, PASSPHRASE);

    sessionStorage.clear();
    const secondVault = new BYOKVault({ namespace, devMode: true });

    await expect(secondVault.unlock("definitely-not-right")).rejects.toBeInstanceOf(
      WrongPassphraseError
    );
    await expect(
      secondVault.withKey(async (key) => key, { passphrase: "wrong-again" })
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("blocks calls when the circuit breaker limit is reached", async () => {
    const namespace = uniqueNamespace("circuit-breaker");
    const vault = new BYOKVault({
      namespace,
      maxTokens: 100,
      devMode: false
    });
    await vault.setKey(API_KEY, PASSPHRASE);

    await vault.withKey(async () => {
      vault.reportUsage(60);
    });
    expect(vault.getUsage()).toBe(60);

    await expect(
      vault.withKey(async () => "never", { requestedTokens: 50 })
    ).rejects.toBeInstanceOf(CircuitBreakerLimitError);

    await vault.withKey(
      async () => {
        vault.reportUsage(45);
      },
      { requestedTokens: 40 }
    );
    expect(vault.getUsage()).toBe(105);

    await expect(
      vault.withKey(async () => "blocked", { requestedTokens: 1 })
    ).rejects.toBeInstanceOf(CircuitBreakerLimitError);
  });

  it("supports runtime max token updates within developer bounds", async () => {
    const namespace = uniqueNamespace("runtime-max-tokens");
    const vault = new BYOKVault({
      namespace,
      maxTokens: 100,
      hardMinTokens: 50,
      hardMaxTokens: 200,
      devMode: false
    });
    await vault.setKey(API_KEY, PASSPHRASE);

    expect(vault.getMaxTokens()).toBe(100);
    expect(vault.getHardMinTokens()).toBe(50);
    expect(vault.getHardMaxTokens()).toBe(200);

    vault.setMaxTokens(150.9);
    expect(vault.getMaxTokens()).toBe(150);

    await vault.withKey(async () => {
      vault.reportUsage(150);
    });
    expect(vault.getUsage()).toBe(150);

    vault.setMaxTokens(120);
    await expect(
      vault.withKey(async () => "blocked", { requestedTokens: 1 })
    ).rejects.toBeInstanceOf(CircuitBreakerLimitError);
  });

  it("rejects runtime max token updates outside developer bounds", () => {
    const namespace = uniqueNamespace("runtime-max-token-bounds");
    const vault = new BYOKVault({
      namespace,
      maxTokens: 100,
      hardMinTokens: 50,
      hardMaxTokens: 150
    });

    expect(() => vault.setMaxTokens(49)).toThrow("greater than or equal to 50");
    expect(() => vault.setMaxTokens(151)).toThrow(
      "less than or equal to 150"
    );
  });

  it("requires maxTokens when hard token bounds are configured", () => {
    expect(
      () =>
        new BYOKVault({
          namespace: uniqueNamespace("hard-bounds-without-max"),
          hardMinTokens: 10
        })
    ).toThrow("require maxTokens");
  });

  it("throws when updating max tokens while breaker is disabled", () => {
    const vault = new BYOKVault({ namespace: uniqueNamespace("set-max-disabled") });
    expect(() => vault.setMaxTokens(1_000)).toThrowError(
      CircuitBreakerDisabledError
    );
  });

  it("warns in dev mode when reportUsage is skipped", async () => {
    const namespace = uniqueNamespace("missing-report");
    const warn = vi.fn();
    const vault = new BYOKVault({
      namespace,
      maxTokens: 100,
      devMode: true,
      logger: { warn }
    });
    await vault.setKey(API_KEY, PASSPHRASE);

    await vault.withKey(async () => "ok");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0] ?? "")).toContain("reportUsage");

    warn.mockClear();
    await vault.withKey(async () => {
      vault.reportUsage(1);
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn when withKey throws before completion", async () => {
    const namespace = uniqueNamespace("throw-without-report");
    const warn = vi.fn();
    const vault = new BYOKVault({
      namespace,
      maxTokens: 100,
      devMode: true,
      logger: { warn }
    });
    await vault.setKey(API_KEY, PASSPHRASE);

    await expect(
      vault.withKey(async () => {
        throw new Error("provider failure");
      })
    ).rejects.toThrow("provider failure");

    expect(warn).not.toHaveBeenCalled();
  });

  it("supports nuke reset flow", async () => {
    const namespace = uniqueNamespace("nuke");
    const vault = new BYOKVault({
      namespace,
      maxTokens: 100,
      devMode: false
    });
    await vault.setKey(API_KEY, PASSPHRASE);
    await vault.withKey(async () => {
      vault.reportUsage(20);
    });

    vault.nuke();
    expect(vault.getUsage()).toBe(0);
    expect(vault.hasStoredKey()).toBe(false);
    expect(localStorage.getItem(`${namespace}:encrypted-key`)).toBeNull();
    expect(sessionStorage.getItem(`${namespace}:derived-key`)).toBeNull();

    await expect(vault.withKey(async () => "nope")).rejects.toBeInstanceOf(KeyNotFoundError);
  });

  it("requires unlock state when no passphrase is provided", async () => {
    const namespace = uniqueNamespace("locked-state");
    const vault = new BYOKVault({ namespace, devMode: true });
    await vault.setKey(API_KEY, PASSPHRASE);

    sessionStorage.clear();
    const freshVault = new BYOKVault({ namespace, devMode: true });

    await expect(freshVault.withKey(async () => "nope")).rejects.toBeInstanceOf(VaultLockedError);
  });

  it("supports manual lock without deleting stored ciphertext", async () => {
    const namespace = uniqueNamespace("manual-lock");
    const vault = new BYOKVault({ namespace, devMode: true });
    await vault.setKey(API_KEY, PASSPHRASE);

    expect(vault.isLocked()).toBe(false);
    vault.lock();
    expect(vault.isLocked()).toBe(true);
    expect(vault.hasStoredKey()).toBe(true);

    await expect(vault.withKey(async () => "nope")).rejects.toBeInstanceOf(VaultLockedError);
    await expect(
      vault.withKey(async (key) => key, { passphrase: PASSPHRASE })
    ).resolves.toBe(API_KEY);
  });

  it("stores encrypted config metadata and preserves withKey compatibility", async () => {
    const namespace = uniqueNamespace("config-metadata");
    const vault = new BYOKVault({ namespace, devMode: true });

    await vault.setConfig(
      {
        apiKey: API_KEY,
        provider: "openai",
        organizationId: "org_test",
        preferences: { model: "gpt-4.1-mini", temperature: 0.2 }
      },
      PASSPHRASE
    );

    const config = await vault.withConfig(async (decryptedConfig) => decryptedConfig);
    expect(config.apiKey).toBe(API_KEY);
    expect(config.organizationId).toBe("org_test");
    expect(config.preferences).toEqual({ model: "gpt-4.1-mini", temperature: 0.2 });

    const key = await vault.withKey(async (decryptedKey) => decryptedKey);
    expect(key).toBe(API_KEY);

    const raw = localStorage.getItem(`${namespace}:encrypted-key`);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain(API_KEY);
    const blob = JSON.parse(raw ?? "{}");
    expect(blob.version).toBe(2);
  });

  it("lazily migrates legacy v1 blobs to version 2 after successful decrypt", async () => {
    const namespace = uniqueNamespace("legacy-migration");
    const legacyBlob = await encryptKey(API_KEY, PASSPHRASE);
    localStorage.setItem(`${namespace}:encrypted-key`, JSON.stringify(legacyBlob));
    sessionStorage.clear();

    const vault = new BYOKVault({ namespace, devMode: true });
    await expect(
      vault.withConfig(async (decryptedConfig) => decryptedConfig, { passphrase: PASSPHRASE })
    ).resolves.toMatchObject({ apiKey: API_KEY });

    const migratedBlob = vault.getEncryptedBlob();
    expect(migratedBlob?.version).toBe(2);
    expect(migratedBlob?.iterations).toBe(legacyBlob.iterations);
    expect(migratedBlob?.salt).toBe(legacyBlob.salt);
  });

  it("keeps decryptKey helper compatible with config blobs", async () => {
    const namespace = uniqueNamespace("decrypt-key-v2");
    const vault = new BYOKVault({ namespace, devMode: true });
    await vault.setConfig({ apiKey: API_KEY, model: "gpt-4.1-mini" }, PASSPHRASE);

    const blob = vault.getEncryptedBlob();
    expect(blob?.version).toBe(2);
    await expect(decryptKey(blob!, PASSPHRASE)).resolves.toBe(API_KEY);
  });

  it("enforces pbkdf2 iteration floor", () => {
    expect(
      () =>
        new BYOKVault({
          namespace: uniqueNamespace("pbkdf2-floor"),
          pbkdf2Iterations: 199_999
        })
    ).toThrow(PBKDF2PolicyError);
  });
});
