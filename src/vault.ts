import { CircuitBreaker } from "./circuit-breaker.js";
import { base64ToBytes } from "./encoding.js";
import {
  DEFAULT_PBKDF2_ITERATIONS,
  decryptWithKeyBits,
  deriveKeyBits,
  encryptKey,
  type EncryptedKeyBlob
} from "./crypto.js";
import {
  CircuitBreakerDisabledError,
  KeyNotFoundError,
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

const DEFAULT_NAMESPACE = "byok-browser-vault";
const DEFAULT_MIN_PASSPHRASE_LENGTH = 8;

interface ScopeState {
  reported: boolean;
}

export interface WithKeyOptions {
  requestedTokens?: number;
  passphrase?: string;
}

export interface BYOKVaultOptions {
  namespace?: string;
  minPassphraseLength?: number;
  pbkdf2Iterations?: number;
  maxTokens?: number;
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
    this.pbkdf2Iterations = options.pbkdf2Iterations ?? DEFAULT_PBKDF2_ITERATIONS;
    this.devMode = options.devMode ?? inferDevMode();
    this.logger = options.logger ?? console;

    if (options.maxTokens !== undefined) {
      this.breaker = new CircuitBreaker({
        maxTokens: options.maxTokens,
        storage: sessionStorage,
        storageKey: keys.tokenUsage
      });
    }
  }

  async setKey(apiKey: string, passphrase: string): Promise<void> {
    this.assertPassphrase(passphrase);
    if (!apiKey) {
      throw new Error("apiKey cannot be empty.");
    }

    const blob = await encryptKey(apiKey, passphrase, {
      iterations: this.pbkdf2Iterations
    });
    this.keyStorage.set(blob);

    const keyBits = await deriveKeyBits(
      passphrase,
      base64ToBytes(blob.salt),
      blob.iterations
    );
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
    const salt = base64ToBytes(blob.salt);
    const keyBits = await deriveKeyBits(passphrase, salt, blob.iterations);
    await this.decryptOrThrowWrongPassphrase(blob, keyBits);
    this.sessionCache.save({
      salt: blob.salt,
      iterations: blob.iterations,
      keyBits
    });
  }

  async withKey<T>(
    callback: (decryptedKey: string) => Promise<T> | T,
    options: WithKeyOptions = {}
  ): Promise<T> {
    this.breaker?.assertCanProceed(options.requestedTokens);
    const scope: ScopeState = { reported: false };
    this.scopes.push(scope);

    try {
      // If malicious script runs in-origin (XSS), it can still read this value in-flight.
      // This API narrows exposure windows; it does not eliminate active injection risk.
      const decryptedKey = await this.resolveDecryptedKey(options.passphrase);
      return await callback(decryptedKey);
    } finally {
      this.scopes.pop();
      if (this.breaker && this.devMode && !scope.reported) {
        this.logger.warn(
          "[byok-browser-vault] withKey completed without reportUsage(tokens). Circuit breaker accounting is incomplete."
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

  private async resolveDecryptedKey(passphrase?: string): Promise<string> {
    const blob = this.requireStoredBlob();
    const cachedBits = this.sessionCache.load(blob.salt, blob.iterations);
    if (cachedBits) {
      try {
        return await decryptWithKeyBits(blob, cachedBits);
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
    const decryptedKey = await this.decryptOrThrowWrongPassphrase(blob, keyBits);
    this.sessionCache.save({
      salt: blob.salt,
      iterations: blob.iterations,
      keyBits
    });
    return decryptedKey;
  }

  private async decryptOrThrowWrongPassphrase(
    blob: EncryptedKeyBlob,
    keyBits: Uint8Array
  ): Promise<string> {
    try {
      return await decryptWithKeyBits(blob, keyBits);
    } catch (error) {
      if (error instanceof WrongPassphraseError) {
        throw error;
      }
      throw error;
    }
  }
}
