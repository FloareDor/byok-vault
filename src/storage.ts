import { base64ToBytes, bytesToBase64 } from "./encoding.js";
import type { EncryptedKeyBlob } from "./crypto.js";

interface SessionRecord {
  salt: string;
  iterations: number;
  keyBits: string;
}

export interface StorageKeys {
  encryptedKey: string;
  sessionKey: string;
  tokenUsage: string;
}

export function getStorageKeys(namespace: string): StorageKeys {
  return {
    encryptedKey: `${namespace}:encrypted-key`,
    sessionKey: `${namespace}:derived-key`,
    tokenUsage: `${namespace}:token-usage`
  };
}

function isEncryptedKeyBlob(input: unknown): input is EncryptedKeyBlob {
  if (!input || typeof input !== "object") {
    return false;
  }
  const blob = input as Record<string, unknown>;
  const baseShapeValid =
    (blob.version === 1 || blob.version === 2 || blob.version === 3) &&
    typeof blob.iterations === "number" &&
    typeof blob.salt === "string" &&
    typeof blob.iv === "string" &&
    typeof blob.ciphertext === "string" &&
    typeof blob.createdAt === "string";
  if (!baseShapeValid) {
    return false;
  }

  if (blob.version !== 3) {
    return true;
  }

  const unlock = blob.unlock as Record<string, unknown> | undefined;
  return (
    !!unlock &&
    unlock.mode === "passkey" &&
    typeof unlock.credentialId === "string" &&
    typeof unlock.prfSalt === "string" &&
    (unlock.rpId === undefined || typeof unlock.rpId === "string")
  );
}

export function resolveStorage(kind: "localStorage" | "sessionStorage", fallback?: Storage): Storage {
  if (fallback) {
    return fallback;
  }
  const candidate = (globalThis as Record<string, unknown>)[kind];
  if (!candidate) {
    throw new Error(`${kind} is not available. Provide it through constructor options.`);
  }
  return candidate as Storage;
}

export class EncryptedKeyStorage {
  constructor(private readonly storage: Storage, private readonly key: string) {}

  get(): EncryptedKeyBlob | null {
    const raw = this.storage.getItem(this.key);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return isEncryptedKeyBlob(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  set(blob: EncryptedKeyBlob): void {
    this.storage.setItem(this.key, JSON.stringify(blob));
  }

  clear(): void {
    this.storage.removeItem(this.key);
  }
}

export class SessionKeyCache {
  constructor(private readonly storage: Storage, private readonly key: string) {}

  load(salt: string, iterations: number): Uint8Array | null {
    const raw = this.storage.getItem(this.key);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as SessionRecord;
      if (
        parsed.salt !== salt ||
        parsed.iterations !== iterations ||
        typeof parsed.keyBits !== "string"
      ) {
        return null;
      }
      return base64ToBytes(parsed.keyBits);
    } catch {
      return null;
    }
  }

  save(payload: { salt: string; iterations: number; keyBits: Uint8Array }): void {
    const record: SessionRecord = {
      salt: payload.salt,
      iterations: payload.iterations,
      keyBits: bytesToBase64(payload.keyBits)
    };
    this.storage.setItem(this.key, JSON.stringify(record));
  }

  clear(): void {
    this.storage.removeItem(this.key);
  }
}
