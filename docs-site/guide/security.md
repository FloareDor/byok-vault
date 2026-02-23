# Security Notes

## What This Package Helps With

- Avoids storing API keys as plaintext in browser storage.
- Uses PBKDF2 + AES-GCM for passphrase mode encryption at rest.
- Supports passkey-based unlock for biometric UX on supported platforms.
- Keeps decrypted key/config access inside a callback.

## What This Package Does Not Solve

- It does not stop active XSS attacks.
- If malicious JavaScript runs in your origin, it can still read keys in-flight.
- JavaScript cannot force immediate memory wipe of strings.
- Passkey support depends on browser/authenticator capabilities (WebAuthn + PRF path).

## Practical Advice

- Use a strong passphrase UX.
- If you offer passkeys, keep passphrase fallback for unsupported devices.
- Add a clear reset path (`nuke()`).
- Use CSP and strict input sanitization in your app.
- For high-security threat models, use a server-side proxy.
