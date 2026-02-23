export class BYOKVaultError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = this.constructor.name;
  }
}

export class PassphrasePolicyError extends BYOKVaultError {
  constructor(minLength: number) {
    super(
      "PASSPHRASE_POLICY",
      `Passphrase must be at least ${minLength} characters.`
    );
  }
}

export class PBKDF2PolicyError extends BYOKVaultError {
  constructor(minIterations: number) {
    super(
      "PBKDF2_POLICY",
      `pbkdf2Iterations must be a finite integer greater than or equal to ${minIterations}.`
    );
  }
}

export class KeyNotFoundError extends BYOKVaultError {
  constructor() {
    super("KEY_NOT_FOUND", "No encrypted API key is stored in the vault.");
  }
}

export class VaultLockedError extends BYOKVaultError {
  constructor() {
    super(
      "VAULT_LOCKED",
      "Vault is locked. Call unlock(passphrase) or pass a passphrase to withKey."
    );
  }
}

export class WrongPassphraseError extends BYOKVaultError {
  constructor() {
    super(
      "WRONG_PASSPHRASE",
      "Could not decrypt key. The passphrase appears to be incorrect."
    );
  }
}

export class InvalidUsageReportError extends BYOKVaultError {
  constructor() {
    super(
      "INVALID_USAGE_REPORT",
      "Token usage must be a finite number greater than or equal to zero."
    );
  }
}

export class CircuitBreakerLimitError extends BYOKVaultError {
  constructor(message: string) {
    super("CIRCUIT_BREAKER_LIMIT", message);
  }
}

export class CircuitBreakerDisabledError extends BYOKVaultError {
  constructor() {
    super(
      "CIRCUIT_BREAKER_DISABLED",
      "Circuit breaker is disabled because maxTokens was not configured."
    );
  }
}
