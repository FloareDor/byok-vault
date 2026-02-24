import { describe, expect, it, vi } from "vitest";

import {
  BYOKVault,
  CircuitBreakerDisabledError,
  CircuitBreakerLimitError,
  decryptKey,
  encryptKey,
  KeyNotFoundError,
  PBKDF2PolicyError,
  PasskeyNotEnrolledError,
  PasskeyNotSupportedError,
  PasskeyUnlockFailedError,
  type PasskeyAdapter,
  VaultLockedError,
  WrongPassphraseError
} from "../src/index.js";
import type { PasskeyCreateRequest, PasskeyGetRequest } from "../src/passkey.js";

const API_KEY = "sk-test-do-not-use";
const PASSPHRASE = "correct horse battery staple";

function uniqueNamespace(prefix: string): string {
  const random = Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function toBytesKey(bytes: Uint8Array): string {
  return Array.from(bytes).join(",");
}

class MockPasskeyAdapter implements PasskeyAdapter {
  private readonly secrets = new Map<string, Uint8Array>();

  constructor(
    private readonly options: {
      supported?: boolean;
      failGet?: boolean;
    } = {}
  ) {}

  isSupported(): boolean {
    return this.options.supported ?? true;
  }

  async create(request: PasskeyCreateRequest): Promise<{ credentialId: Uint8Array; prfOutput: Uint8Array }> {
    const credentialId = new Uint8Array(16);
    for (let index = 0; index < credentialId.length; index += 1) {
      const userByte = request.userId[index % request.userId.length] ?? 0;
      const challengeByte = request.challenge[index % request.challenge.length] ?? 0;
      credentialId[index] = userByte ^ challengeByte;
    }

    const secret = new Uint8Array(32);
    for (let index = 0; index < secret.length; index += 1) {
      const saltByte = request.prfInput[index % request.prfInput.length] ?? 0;
      const credentialByte = credentialId[index % credentialId.length] ?? 0;
      secret[index] = saltByte ^ credentialByte;
    }

    this.secrets.set(toBytesKey(credentialId), secret);
    return { credentialId, prfOutput: secret };
  }

  async get(request: PasskeyGetRequest): Promise<{ prfOutput: Uint8Array }> {
    if (this.options.failGet) {
      throw new Error("simulated passkey assertion failure");
    }
    const secret = this.secrets.get(toBytesKey(request.credentialId));
    if (!secret) {
      throw new Error("credential not found");
    }
    return { prfOutput: secret };
  }
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

  it("exposes unified state and canCall helpers", async () => {
    const namespace = uniqueNamespace("state-helpers");
    const vault = new BYOKVault({ namespace, devMode: true });

    expect(vault.getState()).toBe("none");
    expect(vault.canCall()).toBe(false);

    await vault.setKey(API_KEY, PASSPHRASE);
    expect(vault.getState()).toBe("unlocked");
    expect(vault.canCall()).toBe(true);

    vault.lock();
    expect(vault.getState()).toBe("locked");
    expect(vault.canCall()).toBe(false);

    await vault.unlock(PASSPHRASE);
    expect(vault.getState()).toBe("unlocked");
    expect(vault.canCall()).toBe(true);

    vault.nuke();
    expect(vault.getState()).toBe("none");
    expect(vault.canCall()).toBe(false);
  });

  it("supports explicit session modes for unlock persistence", async () => {
    const namespace = uniqueNamespace("session-mode");
    const vault = new BYOKVault({
      namespace,
      devMode: true,
      sessionMode: "action"
    });

    await vault.setKey(API_KEY, PASSPHRASE);
    expect(vault.isLocked()).toBe(true);

    await expect(vault.withKey(async () => "nope")).rejects.toBeInstanceOf(VaultLockedError);
    await expect(
      vault.withKey(async (key) => key, {
        passphrase: PASSPHRASE,
        session: "action"
      })
    ).resolves.toBe(API_KEY);
    expect(vault.isLocked()).toBe(true);

    await vault.unlock(PASSPHRASE);
    expect(vault.isLocked()).toBe(true);

    await vault.unlock(PASSPHRASE, { session: "tab" });
    expect(vault.isLocked()).toBe(false);
  });

  it("supports passkey enrollment and unlock flow with metadata config", async () => {
    const namespace = uniqueNamespace("passkey-enroll-unlock");
    const adapter = new MockPasskeyAdapter();
    const vault = new BYOKVault({
      namespace,
      devMode: true,
      passkeyAdapter: adapter
    });

    await vault.setConfigWithPasskey(
      {
        apiKey: API_KEY,
        provider: "openai",
        orgId: "org-passkey-1"
      },
      {
        rpName: "BYOK Vault Test",
        userName: "alice@example.com",
        userDisplayName: "Alice"
      }
    );

    expect(vault.isPasskeyEnrolled()).toBe(true);
    const raw = localStorage.getItem(`${namespace}:encrypted-key`) ?? "{}";
    const stored = JSON.parse(raw);
    expect(stored.version).toBe(3);
    expect(raw).not.toContain(API_KEY);

    await expect(vault.withKey(async (key) => key)).resolves.toBe(API_KEY);
    vault.lock();
    await expect(vault.withKey(async () => "nope")).rejects.toBeInstanceOf(PasskeyUnlockFailedError);

    await vault.unlockWithPasskey();
    await expect(vault.withConfig(async (config) => config.orgId)).resolves.toBe("org-passkey-1");
  });

  it("throws PASSKEY_NOT_SUPPORTED when passkey adapter support is unavailable", async () => {
    const namespace = uniqueNamespace("passkey-not-supported");
    const vault = new BYOKVault({
      namespace,
      devMode: true,
      passkeyAdapter: new MockPasskeyAdapter({ supported: false })
    });

    await expect(
      vault.setConfigWithPasskey(
        { apiKey: API_KEY },
        { rpName: "BYOK Vault Test", userName: "bob@example.com" }
      )
    ).rejects.toBeInstanceOf(PasskeyNotSupportedError);
  });

  it("throws PASSKEY_NOT_ENROLLED when unlocking passkey for passphrase vault", async () => {
    const namespace = uniqueNamespace("passkey-not-enrolled");
    const vault = new BYOKVault({
      namespace,
      devMode: true,
      passkeyAdapter: new MockPasskeyAdapter()
    });
    await vault.setKey(API_KEY, PASSPHRASE);

    await expect(vault.unlockWithPasskey()).rejects.toBeInstanceOf(PasskeyNotEnrolledError);
  });

  it("throws PASSKEY_UNLOCK_FAILED when assertion cannot resolve credential", async () => {
    const namespace = uniqueNamespace("passkey-unlock-failed");
    const enrollVault = new BYOKVault({
      namespace,
      devMode: true,
      passkeyAdapter: new MockPasskeyAdapter()
    });
    await enrollVault.setConfigWithPasskey(
      { apiKey: API_KEY },
      { rpName: "BYOK Vault Test", userName: "carol@example.com" }
    );

    sessionStorage.clear();
    const unlockVault = new BYOKVault({
      namespace,
      devMode: true,
      passkeyAdapter: new MockPasskeyAdapter({ failGet: true })
    });

    await expect(unlockVault.unlockWithPasskey()).rejects.toBeInstanceOf(PasskeyUnlockFailedError);
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
