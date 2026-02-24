export {
  DEFAULT_PBKDF2_ITERATIONS,
  decryptConfigWithKeyBits,
  decryptKey,
  decryptWithKeyBits,
  deriveKeyBitsFromSecret,
  deriveKeyBits,
  encryptConfig,
  encryptConfigWithKeyBits,
  encryptConfigWithPasskeyMaterial,
  encryptKey
} from "./crypto.js";
export { CircuitBreaker } from "./circuit-breaker.js";
export { BrowserPasskeyAdapter, createBrowserPasskeyAdapter } from "./passkey.js";
export { BYOKVault } from "./vault.js";
export {
  BYOKVaultError,
  CircuitBreakerDisabledError,
  CircuitBreakerLimitError,
  InvalidUsageReportError,
  KeyNotFoundError,
  PBKDF2PolicyError,
  PasskeyNotEnrolledError,
  PasskeyNotSupportedError,
  PasskeyUnlockFailedError,
  PassphrasePolicyError,
  VaultLockedError,
  WrongPassphraseError
} from "./errors.js";
export type { EncryptedKeyBlob } from "./crypto.js";
export type { PasskeyAdapter } from "./passkey.js";
export type {
  BYOKVaultOptions,
  SetConfigWithPasskeyOptions,
  UnlockWithPasskeyOptions,
  VaultConfig,
  VaultSessionMode,
  VaultState,
  WithKeyOptions
} from "./vault.js";
