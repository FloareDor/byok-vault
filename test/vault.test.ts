import { describe, expect, it, vi } from "vitest";

import {
  BYOKVault,
  CircuitBreakerLimitError,
  KeyNotFoundError,
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
});
