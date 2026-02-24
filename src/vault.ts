import { CircuitBreaker } from "./circuit-breaker.js";
import { base64ToBytes, utf8ToBytes } from "./encoding.js";
import {
  DEFAULT_PBKDF2_ITERATIONS,
  decryptConfigWithKeyBits,
  deriveKeyBitsFromSecret,
  deriveKeyBits,
  encryptConfig,
  encryptConfigWithKeyBits,
  encryptConfigWithPasskeyMaterial,
  type EncryptedKeyBlob,
  type EncryptedPasskeyConfigBlob,
  type VaultConfig as CryptoVaultConfig
} from "./crypto.js";
import {
  CircuitBreakerDisabledError,
  KeyNotFoundError,
  PBKDF2PolicyError,
  PasskeyNotEnrolledError,
  PasskeyNotSupportedError,
  PasskeyUnlockFailedError,
  PassphrasePolicyError,
  VaultLockedError,
  WrongPassphraseError
} from "./errors.js";
import { createBrowserPasskeyAdapter, type PasskeyAdapter } from "./passkey.js";
import {
  EncryptedKeyStorage,
  SessionKeyCache,
  getStorageKeys,
  resolveStorage
} from "./storage.js";

const DEFAULT_NAMESPACE = "byok-vault";
const DEFAULT_MIN_PASSPHRASE_LENGTH = 8;
const PASSKEY_SALT_BYTES = 32;
const PASSKEY_CHALLENGE_BYTES = 32;

interface ScopeState {
  reported: boolean;
}

export interface WithKeyOptions {
  requestedTokens?: number;
  passphrase?: string;
  session?: VaultSessionMode;
}

export interface SetConfigWithPasskeyOptions {
  rpName: string;
  userName: string;
  userDisplayName?: string;
  userId?: string | Uint8Array;
  rpId?: string;
  timeoutMs?: number;
}

export interface UnlockWithPasskeyOptions {
  timeoutMs?: number;
  session?: VaultSessionMode;
}

export interface ImportKeyOptions {
  clearStorageKey?: string;
  plainStorage?: Storage;
}

export type VaultConfig = CryptoVaultConfig;
export type VaultState = "none" | "locked" | "unlocked";
export type VaultSessionMode = "tab" | "action";

export interface BYOKVaultOptions {
  namespace?: string;
  minPassphraseLength?: number;
  pbkdf2Iterations?: number;
  maxTokens?: number;
  hardMinTokens?: number;
  hardMaxTokens?: number;
  devMode?: boolean;
  localStorage?: Storage;
  sessionStorage?: Storage;
  passkeyAdapter?: PasskeyAdapter;
  logger?: Pick<Console, "warn">;
  sessionMode?: VaultSessionMode;
}

function inferDevMode(): boolean {
  const processCandidate = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
  if (!processCandidate?.env?.NODE_ENV) {
    return true;
  }
  return processCandidate.env.NODE_ENV !== "production";
}

function assertWebCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is not available in this environment.");
  }
  return globalThis.crypto;
}

function getRandomBytes(size: number): Uint8Array {
  const cryptoProvider = assertWebCrypto();
  const random = new Uint8Array(size);
  cryptoProvider.getRandomValues(random);
  return random;
}

export class BYOKVault {
  private readonly keyStorage: EncryptedKeyStorage;
  private readonly localStorageRef: Storage;
  private readonly sessionCache: SessionKeyCache;
  private readonly minPassphraseLength: number;
  private readonly pbkdf2Iterations: number;
  private readonly breaker?: CircuitBreaker;
  private readonly passkeyAdapter: PasskeyAdapter;
  private readonly devMode: boolean;
  private readonly logger: Pick<Console, "warn">;
  private readonly defaultSessionMode: VaultSessionMode;
  private readonly scopes: ScopeState[] = [];

  constructor(options: BYOKVaultOptions = {}) {
    const namespace = options.namespace ?? DEFAULT_NAMESPACE;
    const localStorage = resolveStorage("localStorage", options.localStorage);
    const sessionStorage = resolveStorage("sessionStorage", options.sessionStorage);
    const keys = getStorageKeys(namespace);

    this.localStorageRef = localStorage;
    this.keyStorage = new EncryptedKeyStorage(localStorage, keys.encryptedKey);
    this.sessionCache = new SessionKeyCache(sessionStorage, keys.sessionKey);
    this.minPassphraseLength = options.minPassphraseLength ?? DEFAULT_MIN_PASSPHRASE_LENGTH;
    if (
      !Number.isFinite(this.minPassphraseLength) ||
      !Number.isInteger(this.minPassphraseLength) ||
      this.minPassphraseLength < 1
    ) {
      throw new Error("minPassphraseLength must be an integer greater than or equal to 1.");
    }

    this.pbkdf2Iterations = options.pbkdf2Iterations ?? DEFAULT_PBKDF2_ITERATIONS;
    if (
      !Number.isFinite(this.pbkdf2Iterations) ||
      !Number.isInteger(this.pbkdf2Iterations) ||
      this.pbkdf2Iterations < DEFAULT_PBKDF2_ITERATIONS
    ) {
      throw new PBKDF2PolicyError(DEFAULT_PBKDF2_ITERATIONS);
    }

    this.devMode = options.devMode ?? inferDevMode();
    this.logger = options.logger ?? console;
    this.passkeyAdapter = options.passkeyAdapter ?? createBrowserPasskeyAdapter();
    this.defaultSessionMode = options.sessionMode ?? "tab";
    if (
      this.defaultSessionMode !== "tab" &&
      this.defaultSessionMode !== "action"
    ) {
      throw new Error("sessionMode must be either 'tab' or 'action'.");
    }

    if (
      options.maxTokens === undefined &&
      (options.hardMinTokens !== undefined || options.hardMaxTokens !== undefined)
    ) {
      throw new Error(
        "hardMinTokens and hardMaxTokens require maxTokens to be configured."
      );
    }

    if (options.maxTokens !== undefined) {
      this.breaker = new CircuitBreaker({
        maxTokens: options.maxTokens,
        hardMinTokens: options.hardMinTokens,
        hardMaxTokens: options.hardMaxTokens,
        storage: sessionStorage,
        storageKey: keys.tokenUsage
      });
    }
  }

  async setKey(apiKey: string, passphrase: string): Promise<void> {
    if (!apiKey) {
      throw new Error("apiKey cannot be empty.");
    }
    await this.setConfig({ apiKey }, passphrase);
  }

  async importKey(
    plainKey: string,
    passphrase: string,
    options: ImportKeyOptions = {}
  ): Promise<void> {
    await this.setKey(plainKey, passphrase);
    if (options.clearStorageKey) {
      const plainStorage = options.plainStorage ?? this.localStorageRef;
      plainStorage.removeItem(options.clearStorageKey);
    }
  }

  async setConfig(config: VaultConfig, passphrase: string): Promise<void> {
    this.assertPassphrase(passphrase);
    const blob = await encryptConfig(config, passphrase, {
      iterations: this.pbkdf2Iterations
    });
    this.keyStorage.set(blob);

    const keyBits = await deriveKeyBits(
      passphrase,
      base64ToBytes(blob.salt),
      blob.iterations
    );
    this.saveSessionCache(blob, keyBits, this.defaultSessionMode);

    this.breaker?.reset();
  }

  async setConfigWithPasskey(
    config: VaultConfig,
    options: SetConfigWithPasskeyOptions
  ): Promise<void> {
    this.assertPasskeySupported();
    if (!options.rpName.trim()) {
      throw new Error("Passkey enrollment requires a non-empty rpName.");
    }
    if (!options.userName.trim()) {
      throw new Error("Passkey enrollment requires a non-empty userName.");
    }

    const prfSalt = getRandomBytes(PASSKEY_SALT_BYTES);
    const challenge = getRandomBytes(PASSKEY_CHALLENGE_BYTES);
    const userId =
      typeof options.userId === "string"
        ? utf8ToBytes(options.userId)
        : options.userId ?? getRandomBytes(16);
    const userDisplayName = options.userDisplayName?.trim() || options.userName;

    let credential: { credentialId: Uint8Array; prfOutput: Uint8Array };
    try {
      credential = await this.passkeyAdapter.create({
        challenge,
        userId,
        userName: options.userName,
        userDisplayName,
        rpName: options.rpName,
        rpId: options.rpId,
        timeoutMs: options.timeoutMs,
        prfInput: prfSalt
      });
    } catch (error) {
      if (error instanceof PasskeyUnlockFailedError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : undefined;
      throw new PasskeyUnlockFailedError(message);
    }

    const keyBits = await deriveKeyBitsFromSecret(credential.prfOutput);
    const blob = await encryptConfigWithPasskeyMaterial(config, keyBits, {
      credentialId: credential.credentialId,
      prfSalt,
      rpId: options.rpId
    });
    this.keyStorage.set(blob);
    this.saveSessionCache(blob, keyBits);
    this.breaker?.reset();
  }

  async unlock(passphrase: string, options: { session?: VaultSessionMode } = {}): Promise<void> {
    this.assertPassphrase(passphrase);
    const blob = this.requireStoredBlob();
    if (blob.version === 3) {
      throw new PasskeyUnlockFailedError(
        "This vault is passkey-protected. Use unlockWithPasskey() instead."
      );
    }
    const keyBits = await deriveKeyBits(passphrase, base64ToBytes(blob.salt), blob.iterations);
    const { blob: activeBlob } = await this.decryptConfigAndMaybeMigrate(blob, keyBits);
    this.saveSessionCache(activeBlob, keyBits, this.resolveSessionMode(options.session));
  }

  async unlockWithPasskey(options: UnlockWithPasskeyOptions = {}): Promise<void> {
    this.assertPasskeySupported();
    const blob = this.requirePasskeyBlob();
    const challenge = getRandomBytes(PASSKEY_CHALLENGE_BYTES);

    let assertion: { prfOutput: Uint8Array };
    try {
      assertion = await this.passkeyAdapter.get({
        challenge,
        credentialId: base64ToBytes(blob.unlock.credentialId),
        prfInput: base64ToBytes(blob.unlock.prfSalt),
        rpId: blob.unlock.rpId,
        timeoutMs: options.timeoutMs
      });
    } catch (error) {
      if (error instanceof PasskeyUnlockFailedError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : undefined;
      throw new PasskeyUnlockFailedError(message);
    }

    const keyBits = await deriveKeyBitsFromSecret(assertion.prfOutput);
    try {
      await decryptConfigWithKeyBits(blob, keyBits);
    } catch (error) {
      if (error instanceof WrongPassphraseError) {
        throw new PasskeyUnlockFailedError();
      }
      throw error;
    }
    this.saveSessionCache(blob, keyBits, this.resolveSessionMode(options.session));
  }

  async withKey<T>(
    callback: (decryptedKey: string) => Promise<T> | T,
    options: WithKeyOptions = {}
  ): Promise<T> {
    return this.withConfig((config) => callback(config.apiKey), options);
  }

  async withConfig<T>(
    callback: (decryptedConfig: VaultConfig) => Promise<T> | T,
    options: WithKeyOptions = {}
  ): Promise<T> {
    this.breaker?.assertCanProceed(options.requestedTokens);
    const scope: ScopeState = { reported: false };
    let callbackCompleted = false;
    this.scopes.push(scope);

    try {
      // If malicious script runs in-origin (XSS), it can still read this value in-flight.
      // This API narrows exposure windows; it does not eliminate active injection risk.
      const decryptedConfig = await this.resolveDecryptedConfig(
        options.passphrase,
        options.session
      );
      const result = await callback(decryptedConfig);
      callbackCompleted = true;
      return result;
    } finally {
      this.scopes.pop();
      if (this.breaker && this.devMode && callbackCompleted && !scope.reported) {
        this.logger.warn(
          "[byok-vault] withKey/withConfig completed without reportUsage(tokens). Circuit breaker accounting is incomplete."
        );
      }
    }
  }

  async withKeyScope<T>(
    callback: () => Promise<T> | T,
    options: WithKeyOptions = {}
  ): Promise<T> {
    this.breaker?.assertCanProceed(options.requestedTokens);
    const sessionMode = this.resolveSessionMode(options.session);
    const blob = this.requireStoredBlob();
    const cachedBits = this.sessionCache.load(blob.salt, blob.iterations);
    const shouldRestoreLock = !cachedBits && sessionMode === "action";

    await this.resolveDecryptedConfig(options.passphrase, "tab");
    try {
      return await callback();
    } finally {
      if (shouldRestoreLock) {
        this.lock();
      }
    }
  }

  reportUsage(tokens: number): void {
    if (!this.breaker) {
      throw new CircuitBreakerDisabledError();
    }
    this.breaker.reportUsage(tokens);
    const activeScope = this.scopes.at(-1);
    if (activeScope) {
      activeScope.reported = true;
    }
  }

  getUsage(): number {
    return this.breaker?.getUsage() ?? 0;
  }

  getRemainingTokens(): number {
    return this.breaker?.getRemainingTokens() ?? Number.POSITIVE_INFINITY;
  }

  getMaxTokens(): number | null {
    return this.breaker ? this.breaker.getMaxTokens() : null;
  }

  setMaxTokens(maxTokens: number): void {
    if (!this.breaker) {
      throw new CircuitBreakerDisabledError();
    }
    this.breaker.setMaxTokens(maxTokens);
  }

  getHardMinTokens(): number | null {
    return this.breaker ? this.breaker.getHardMinTokens() : null;
  }

  getHardMaxTokens(): number | null {
    return this.breaker ? this.breaker.getHardMaxTokens() : null;
  }

  hasStoredKey(): boolean {
    return this.keyStorage.get() !== null;
  }

  getState(): VaultState {
    const blob = this.keyStorage.get();
    if (!blob) {
      return "none";
    }
    return this.sessionCache.load(blob.salt, blob.iterations) ? "unlocked" : "locked";
  }

  canCall(): boolean {
    return this.getState() === "unlocked";
  }

  isPasskeyEnrolled(): boolean {
    const blob = this.keyStorage.get();
    return blob?.version === 3;
  }

  isLocked(): boolean {
    return this.getState() !== "unlocked";
  }

  getEncryptedBlob(): EncryptedKeyBlob | null {
    return this.keyStorage.get();
  }

  lock(): void {
    this.sessionCache.clear();
    this.scopes.length = 0;
  }

  nuke(): void {
    this.keyStorage.clear();
    this.sessionCache.clear();
    this.breaker?.reset();
    this.scopes.length = 0;
  }

  private assertPassphrase(passphrase: string): void {
    if (passphrase.length < this.minPassphraseLength) {
      throw new PassphrasePolicyError(this.minPassphraseLength);
    }
  }

  private requireStoredBlob(): EncryptedKeyBlob {
    const blob = this.keyStorage.get();
    if (!blob) {
      throw new KeyNotFoundError();
    }
    return blob;
  }

  private requirePasskeyBlob(): EncryptedPasskeyConfigBlob {
    const blob = this.requireStoredBlob();
    if (blob.version !== 3 || blob.unlock.mode !== "passkey") {
      throw new PasskeyNotEnrolledError();
    }
    return blob;
  }

  private assertPasskeySupported(): void {
    if (!this.passkeyAdapter.isSupported()) {
      throw new PasskeyNotSupportedError();
    }
  }

  private saveSessionCache(
    blob: EncryptedKeyBlob,
    keyBits: Uint8Array,
    mode: VaultSessionMode = "tab"
  ): void {
    if (mode === "action") {
      this.sessionCache.clear();
      return;
    }
    // sessionStorage caching is only for passphrase UX; it is not an extra security boundary.
    this.sessionCache.save({
      salt: blob.salt,
      iterations: blob.iterations,
      keyBits
    });
  }

  private async decryptConfigAndMaybeMigrate(
    blob: EncryptedKeyBlob,
    keyBits: Uint8Array
  ): Promise<{ config: VaultConfig; blob: EncryptedKeyBlob }> {
    const config = await decryptConfigWithKeyBits(blob, keyBits);
    if (blob.version !== 1) {
      return { config, blob };
    }

    const migrated = await encryptConfigWithKeyBits(config, keyBits, {
      iterations: blob.iterations,
      salt: base64ToBytes(blob.salt)
    });
    this.keyStorage.set(migrated);
    return { config, blob: migrated };
  }

  private async resolveDecryptedConfig(
    passphrase?: string,
    sessionModeOverride?: VaultSessionMode
  ): Promise<VaultConfig> {
    const sessionMode = this.resolveSessionMode(sessionModeOverride);
    const blob = this.requireStoredBlob();
    const cachedBits = this.sessionCache.load(blob.salt, blob.iterations);
    if (cachedBits) {
      try {
        const { config, blob: activeBlob } = await this.decryptConfigAndMaybeMigrate(blob, cachedBits);
        this.saveSessionCache(activeBlob, cachedBits);
        return config;
      } catch (error) {
        if (error instanceof WrongPassphraseError) {
          this.sessionCache.clear();
        } else {
          throw error;
        }
      }
    }

    if (blob.version === 3) {
      throw new PasskeyUnlockFailedError(
        "This vault is passkey-protected. Call unlockWithPasskey() before withKey/withConfig."
      );
    }

    if (!passphrase) {
      throw new VaultLockedError();
    }

    this.assertPassphrase(passphrase);
    const keyBits = await deriveKeyBits(
      passphrase,
      base64ToBytes(blob.salt),
      blob.iterations
    );
    const { config, blob: activeBlob } = await this.decryptConfigAndMaybeMigrate(blob, keyBits);
    this.saveSessionCache(activeBlob, keyBits, sessionMode);
    return config;
  }

  private resolveSessionMode(mode?: VaultSessionMode): VaultSessionMode {
    const resolved = mode ?? this.defaultSessionMode;
    if (resolved !== "tab" && resolved !== "action") {
      throw new Error("session mode must be either 'tab' or 'action'.");
    }
    return resolved;
  }
}
