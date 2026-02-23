import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from "./encoding.js";
import { WrongPassphraseError } from "./errors.js";

export const DEFAULT_PBKDF2_ITERATIONS = 200_000;

const DEFAULT_SALT_BYTES = 16;
const IV_BYTES = 12;

interface EncryptedBlobBase {
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
}

export interface EncryptedLegacyKeyBlob extends EncryptedBlobBase {
  version: 1;
}

export interface EncryptedConfigBlob extends EncryptedBlobBase {
  version: 2;
}

export interface PasskeyUnlockMetadata {
  mode: "passkey";
  credentialId: string;
  prfSalt: string;
  rpId?: string;
}

export interface EncryptedPasskeyConfigBlob extends EncryptedBlobBase {
  version: 3;
  unlock: PasskeyUnlockMetadata;
}

export type EncryptedKeyBlob =
  | EncryptedLegacyKeyBlob
  | EncryptedConfigBlob
  | EncryptedPasskeyConfigBlob;

export interface VaultConfig {
  apiKey: string;
  [key: string]: unknown;
}

interface EncryptWithKeyBitsOptions {
  iterations: number;
  salt: Uint8Array;
}

interface EncryptPasskeyOptions {
  credentialId: Uint8Array;
  prfSalt: Uint8Array;
  rpId?: string;
}

interface EncryptOptions {
  iterations?: number;
  saltBytes?: number;
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

function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

export async function deriveKeyBits(
  passphrase: string,
  salt: Uint8Array,
  iterations = DEFAULT_PBKDF2_ITERATIONS
): Promise<Uint8Array> {
  const cryptoProvider = assertWebCrypto();
  const passphraseKey = await cryptoProvider.subtle.importKey(
    "raw",
    asBufferSource(utf8ToBytes(passphrase)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const keyBits = await cryptoProvider.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: asBufferSource(salt),
      iterations
    },
    passphraseKey,
    256
  );
  return new Uint8Array(keyBits);
}

export async function deriveKeyBitsFromSecret(secret: Uint8Array): Promise<Uint8Array> {
  const cryptoProvider = assertWebCrypto();
  const digest = await cryptoProvider.subtle.digest("SHA-256", asBufferSource(secret));
  return new Uint8Array(digest);
}

async function importAesGcmKey(keyBits: Uint8Array): Promise<CryptoKey> {
  const cryptoProvider = assertWebCrypto();
  return cryptoProvider.subtle.importKey(
    "raw",
    asBufferSource(keyBits),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptWithKeyBits(
  keyBits: Uint8Array,
  plaintext: string
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const cryptoProvider = assertWebCrypto();
  const iv = getRandomBytes(IV_BYTES);
  const key = await importAesGcmKey(keyBits);
  const ciphertext = await cryptoProvider.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(iv)
    },
    key,
    asBufferSource(utf8ToBytes(plaintext))
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

async function decryptPayloadWithKeyBits(
  blob: EncryptedKeyBlob,
  keyBits: Uint8Array
): Promise<string> {
  const cryptoProvider = assertWebCrypto();
  const key = await importAesGcmKey(keyBits);
  try {
    const plaintext = await cryptoProvider.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(base64ToBytes(blob.iv))
      },
      key,
      asBufferSource(base64ToBytes(blob.ciphertext))
    );
    return bytesToUtf8(new Uint8Array(plaintext));
  } catch (error) {
    if (error instanceof Error && error.name === "OperationError") {
      throw new WrongPassphraseError();
    }
    throw error;
  }
}

function parseVaultConfig(payload: string): VaultConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Stored vault config payload is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Stored vault config payload must be a JSON object.");
  }

  const apiKey = (parsed as { apiKey?: unknown }).apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error("Stored vault config payload is missing a non-empty apiKey string.");
  }

  return parsed as VaultConfig;
}

function serializeVaultConfig(config: VaultConfig): string {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("config must be a non-null JSON object.");
  }
  if (typeof config.apiKey !== "string" || config.apiKey.length === 0) {
    throw new Error("config.apiKey must be a non-empty string.");
  }

  try {
    return JSON.stringify(config);
  } catch {
    throw new Error("config must be JSON-serializable.");
  }
}

export async function decryptConfigWithKeyBits(
  blob: EncryptedKeyBlob,
  keyBits: Uint8Array
): Promise<VaultConfig> {
  const payload = await decryptPayloadWithKeyBits(blob, keyBits);
  if (blob.version === 1) {
    return { apiKey: payload };
  }
  return parseVaultConfig(payload);
}

async function encryptConfigPayloadWithKeyBits(
  config: VaultConfig,
  keyBits: Uint8Array,
  options: EncryptWithKeyBitsOptions
): Promise<EncryptedConfigBlob> {
  const encrypted = await encryptWithKeyBits(keyBits, serializeVaultConfig(config));
  return {
    version: 2,
    iterations: options.iterations,
    salt: bytesToBase64(options.salt),
    iv: bytesToBase64(encrypted.iv),
    ciphertext: bytesToBase64(encrypted.ciphertext),
    createdAt: new Date().toISOString()
  };
}

export async function decryptWithKeyBits(
  blob: EncryptedKeyBlob,
  keyBits: Uint8Array
): Promise<string> {
  const config = await decryptConfigWithKeyBits(blob, keyBits);
  return config.apiKey;
}

export async function encryptConfigWithKeyBits(
  config: VaultConfig,
  keyBits: Uint8Array,
  options: EncryptWithKeyBitsOptions
): Promise<EncryptedConfigBlob> {
  return encryptConfigPayloadWithKeyBits(config, keyBits, options);
}

export async function encryptConfigWithPasskeyMaterial(
  config: VaultConfig,
  keyBits: Uint8Array,
  options: EncryptPasskeyOptions
): Promise<EncryptedPasskeyConfigBlob> {
  const encrypted = await encryptWithKeyBits(keyBits, serializeVaultConfig(config));
  const salt = bytesToBase64(options.prfSalt);
  return {
    version: 3,
    iterations: 0,
    salt,
    iv: bytesToBase64(encrypted.iv),
    ciphertext: bytesToBase64(encrypted.ciphertext),
    createdAt: new Date().toISOString(),
    unlock: {
      mode: "passkey",
      credentialId: bytesToBase64(options.credentialId),
      prfSalt: salt,
      rpId: options.rpId
    }
  };
}

export async function encryptConfig(
  config: VaultConfig,
  passphrase: string,
  options: EncryptOptions = {}
): Promise<EncryptedConfigBlob> {
  const salt = getRandomBytes(options.saltBytes ?? DEFAULT_SALT_BYTES);
  const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const keyBits = await deriveKeyBits(passphrase, salt, iterations);
  return encryptConfigPayloadWithKeyBits(config, keyBits, { iterations, salt });
}

export async function encryptKey(
  key: string,
  passphrase: string,
  options: EncryptOptions = {}
): Promise<EncryptedKeyBlob> {
  const salt = getRandomBytes(options.saltBytes ?? DEFAULT_SALT_BYTES);
  const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const keyBits = await deriveKeyBits(passphrase, salt, iterations);
  const encrypted = await encryptWithKeyBits(keyBits, key);
  return {
    version: 1,
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(encrypted.iv),
    ciphertext: bytesToBase64(encrypted.ciphertext),
    createdAt: new Date().toISOString()
  };
}

export async function decryptKey(
  blob: EncryptedKeyBlob,
  passphrase: string
): Promise<string> {
  const salt = base64ToBytes(blob.salt);
  const keyBits = await deriveKeyBits(passphrase, salt, blob.iterations);
  return decryptWithKeyBits(blob, keyBits);
}
