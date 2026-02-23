export {
  DEFAULT_PBKDF2_ITERATIONS,
  decryptConfigWithKeyBits,
  decryptKey,
  decryptWithKeyBits,
  deriveKeyBits,
  encryptConfig,
  encryptConfigWithKeyBits,
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
export type { BYOKVaultOptions, VaultConfig, WithKeyOptions } from "./vault.js";
