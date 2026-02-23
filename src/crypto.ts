import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from "./encoding.js";
import { WrongPassphraseError } from "./errors.js";

export const DEFAULT_PBKDF2_ITERATIONS = 200_000;

const DEFAULT_SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedKeyBlob {
  version: 1;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

export async function deriveKeyBits(
  passphrase: string,
  salt: Uint8Array,
  iterations = DEFAULT_PBKDF2_ITERATIONS
): Promise<Uint8Array> {
  const cryptoProvider = assertWebCrypto();
  const passphraseKey = await cryptoProvider.subtle.importKey(
    "raw",
    toArrayBuffer(utf8ToBytes(passphrase)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const keyBits = await cryptoProvider.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations
    },
    passphraseKey,
    256
  );
  return new Uint8Array(keyBits);
}

async function importAesGcmKey(keyBits: Uint8Array): Promise<CryptoKey> {
  const cryptoProvider = assertWebCrypto();
  return cryptoProvider.subtle.importKey(
    "raw",
    toArrayBuffer(keyBits),
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
      iv: toArrayBuffer(iv)
    },
    key,
    toArrayBuffer(utf8ToBytes(plaintext))
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

export async function decryptWithKeyBits(
  blob: EncryptedKeyBlob,
  keyBits: Uint8Array
): Promise<string> {
  const cryptoProvider = assertWebCrypto();
  const key = await importAesGcmKey(keyBits);
  try {
    const plaintext = await cryptoProvider.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(base64ToBytes(blob.iv))
      },
      key,
      toArrayBuffer(base64ToBytes(blob.ciphertext))
    );
    return bytesToUtf8(new Uint8Array(plaintext));
  } catch (error) {
    if (error instanceof Error && error.name === "OperationError") {
      throw new WrongPassphraseError();
    }
    throw error;
  }
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
