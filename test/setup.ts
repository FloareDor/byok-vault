import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
