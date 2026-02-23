export {
  DEFAULT_PBKDF2_ITERATIONS,
  decryptKey,
  decryptWithKeyBits,
  deriveKeyBits,
  encryptKey
} from "./crypto.js";
export { CircuitBreaker } from "./circuit-breaker.js";
export { BYOKVault } from "./vault.js";
export {
  BYOKVaultError,
  CircuitBreakerDisabledError,
  CircuitBreakerLimitError,
  InvalidUsageReportError,
  KeyNotFoundError,
  PBKDF2PolicyError,
  PassphrasePolicyError,
  VaultLockedError,
  WrongPassphraseError
} from "./errors.js";
export type { EncryptedKeyBlob } from "./crypto.js";
export type { BYOKVaultOptions, WithKeyOptions } from "./vault.js";
