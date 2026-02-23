import { CircuitBreaker } from "./circuit-breaker.js";
import { base64ToBytes } from "./encoding.js";
import {
  DEFAULT_PBKDF2_ITERATIONS,
  decryptConfigWithKeyBits,
  deriveKeyBits,
  encryptConfig,
  encryptConfigWithKeyBits,
  type EncryptedKeyBlob,
  type VaultConfig as CryptoVaultConfig
} from "./crypto.js";
import {
  CircuitBreakerDisabledError,
  KeyNotFoundError,
  PBKDF2PolicyError,
  PassphrasePolicyError,
  VaultLockedError,
  WrongPassphraseError
} from "./errors.js";
import {
  EncryptedKeyStorage,
  SessionKeyCache,
  getStorageKeys,
  resolveStorage
} from "./storage.js";

const DEFAULT_NAMESPACE = "byok-vault";
const DEFAULT_MIN_PASSPHRASE_LENGTH = 8;

interface ScopeState {
  reported: boolean;
}

export interface WithKeyOptions {
  requestedTokens?: number;
  passphrase?: string;
}

export type VaultConfig = CryptoVaultConfig;

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
  logger?: Pick<Console, "warn">;
}

function inferDevMode(): boolean {
  const processCandidate = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
  if (!processCandidate?.env?.NODE_ENV) {
    return true;
  }
  return processCandidate.env.NODE_ENV !== "production";
}

export class BYOKVault {
  private readonly keyStorage: EncryptedKeyStorage;
  private readonly sessionCache: SessionKeyCache;
  private readonly minPassphraseLength: number;
  private readonly pbkdf2Iterations: number;
  private readonly breaker?: CircuitBreaker;
  private readonly devMode: boolean;
  private readonly logger: Pick<Console, "warn">;
  private readonly scopes: ScopeState[] = [];

  constructor(options: BYOKVaultOptions = {}) {
    const namespace = options.namespace ?? DEFAULT_NAMESPACE;
    const localStorage = resolveStorage("localStorage", options.localStorage);
    const sessionStorage = resolveStorage("sessionStorage", options.sessionStorage);
    const keys = getStorageKeys(namespace);

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
    // sessionStorage caching is only for passphrase UX; it is not an extra security boundary.
    this.sessionCache.save({
      salt: blob.salt,
      iterations: blob.iterations,
      keyBits
    });

    this.breaker?.reset();
  }

  async unlock(passphrase: string): Promise<void> {
    this.assertPassphrase(passphrase);
    const blob = this.requireStoredBlob();
    const keyBits = await deriveKeyBits(passphrase, base64ToBytes(blob.salt), blob.iterations);
    const { blob: activeBlob } = await this.decryptConfigAndMaybeMigrate(blob, keyBits);
    this.saveSessionCache(activeBlob, keyBits);
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
      const decryptedConfig = await this.resolveDecryptedConfig(options.passphrase);
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

  isLocked(): boolean {
    const blob = this.keyStorage.get();
    if (!blob) {
      return true;
    }
    return this.sessionCache.load(blob.salt, blob.iterations) === null;
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

  private saveSessionCache(blob: EncryptedKeyBlob, keyBits: Uint8Array): void {
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
    if (blob.version === 2) {
      return { config, blob };
    }

    const migrated = await encryptConfigWithKeyBits(config, keyBits, {
      iterations: blob.iterations,
      salt: base64ToBytes(blob.salt)
    });
    this.keyStorage.set(migrated);
    return { config, blob: migrated };
  }

  private async resolveDecryptedConfig(passphrase?: string): Promise<VaultConfig> {
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
    this.saveSessionCache(activeBlob, keyBits);
    return config;
  }
}
