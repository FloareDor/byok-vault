import { PasskeyUnlockFailedError } from "./errors.js";

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function bytesFromUnknown(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return null;
}

function requirePrfOutput(results: AuthenticationExtensionsClientOutputs): Uint8Array {
  const prfOutput = (results as Record<string, unknown>)["prf"];
  if (!prfOutput || typeof prfOutput !== "object") {
    throw new PasskeyUnlockFailedError("WebAuthn PRF extension output is missing.");
  }

  const first = (prfOutput as Record<string, unknown>)["results"];
  if (!first || typeof first !== "object") {
    throw new PasskeyUnlockFailedError("WebAuthn PRF extension results are missing.");
  }

  const secret = bytesFromUnknown((first as Record<string, unknown>)["first"]);
  if (!secret || secret.byteLength === 0) {
    throw new PasskeyUnlockFailedError("WebAuthn PRF extension returned an empty secret.");
  }
  return secret;
}

export interface PasskeyCreateRequest {
  challenge: Uint8Array;
  userId: Uint8Array;
  userName: string;
  userDisplayName: string;
  rpName: string;
  prfInput: Uint8Array;
  rpId?: string;
  timeoutMs?: number;
}

export interface PasskeyCreateResult {
  credentialId: Uint8Array;
  prfOutput: Uint8Array;
}

export interface PasskeyGetRequest {
  challenge: Uint8Array;
  credentialId: Uint8Array;
  prfInput: Uint8Array;
  rpId?: string;
  timeoutMs?: number;
}

export interface PasskeyGetResult {
  prfOutput: Uint8Array;
}

export interface PasskeyAdapter {
  isSupported(): boolean;
  create(request: PasskeyCreateRequest): Promise<PasskeyCreateResult>;
  get(request: PasskeyGetRequest): Promise<PasskeyGetResult>;
}

export class BrowserPasskeyAdapter implements PasskeyAdapter {
  isSupported(): boolean {
    return (
      typeof PublicKeyCredential !== "undefined" &&
      typeof navigator !== "undefined" &&
      !!navigator.credentials?.create &&
      !!navigator.credentials?.get
    );
  }

  async create(request: PasskeyCreateRequest): Promise<PasskeyCreateResult> {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: asArrayBuffer(request.challenge),
        rp: {
          name: request.rpName,
          id: request.rpId
        },
        user: {
          id: asArrayBuffer(request.userId),
          name: request.userName,
          displayName: request.userDisplayName
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 }
        ],
        authenticatorSelection: {
          userVerification: "required",
          residentKey: "preferred"
        },
        timeout: request.timeoutMs,
        attestation: "none",
        extensions: {
          prf: {
            eval: { first: asArrayBuffer(request.prfInput) }
          }
        }
      }
    });

    if (!(credential instanceof PublicKeyCredential)) {
      throw new PasskeyUnlockFailedError("WebAuthn did not return a public key credential.");
    }

    const credentialId = new Uint8Array(credential.rawId);
    if (credentialId.byteLength === 0) {
      throw new PasskeyUnlockFailedError("WebAuthn returned an empty credential ID.");
    }

    const prfOutput = requirePrfOutput(credential.getClientExtensionResults());
    return { credentialId, prfOutput };
  }

  async get(request: PasskeyGetRequest): Promise<PasskeyGetResult> {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: asArrayBuffer(request.challenge),
        allowCredentials: [
          {
            type: "public-key",
            id: asArrayBuffer(request.credentialId)
          }
        ],
        userVerification: "required",
        rpId: request.rpId,
        timeout: request.timeoutMs,
        extensions: {
          prf: {
            eval: { first: asArrayBuffer(request.prfInput) }
          }
        }
      }
    });

    if (!(credential instanceof PublicKeyCredential)) {
      throw new PasskeyUnlockFailedError("WebAuthn did not return a public key assertion.");
    }

    const prfOutput = requirePrfOutput(credential.getClientExtensionResults());
    return { prfOutput };
  }
}

export function createBrowserPasskeyAdapter(): PasskeyAdapter {
  return new BrowserPasskeyAdapter();
}
