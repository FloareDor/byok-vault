import { CircuitBreakerLimitError, InvalidUsageReportError } from "./errors.js";

interface CircuitBreakerOptions {
  maxTokens: number;
  hardMinTokens?: number;
  hardMaxTokens?: number;
  storage: Storage;
  storageKey: string;
}

function parseUsage(raw: string | null): number {
  if (!raw) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export class CircuitBreaker {
  private usage: number;
  private maxTokens: number;
  private readonly hardMinTokens: number;
  private readonly hardMaxTokens: number | null;
  private readonly storage: Storage;
  private readonly storageKey: string;

  constructor(options: CircuitBreakerOptions) {
    const hardMinTokens = normalizeTokenLimit(
      options.hardMinTokens ?? 1,
      "hardMinTokens"
    );
    const hardMaxTokens =
      options.hardMaxTokens === undefined
        ? null
        : normalizeTokenLimit(options.hardMaxTokens, "hardMaxTokens");
    const maxTokens = normalizeTokenLimit(options.maxTokens, "maxTokens");

    if (hardMaxTokens !== null && hardMaxTokens < hardMinTokens) {
      throw new Error("hardMaxTokens must be greater than or equal to hardMinTokens.");
    }
    if (maxTokens < hardMinTokens) {
      throw new Error(`maxTokens must be greater than or equal to ${hardMinTokens}.`);
    }
    if (hardMaxTokens !== null && maxTokens > hardMaxTokens) {
      throw new Error(`maxTokens must be less than or equal to ${hardMaxTokens}.`);
    }

    this.maxTokens = maxTokens;
    this.hardMinTokens = hardMinTokens;
    this.hardMaxTokens = hardMaxTokens;
    this.storage = options.storage;
    this.storageKey = options.storageKey;
    this.usage = parseUsage(this.storage.getItem(this.storageKey));
  }

  assertCanProceed(requestedTokens?: number): void {
    if (this.usage >= this.maxTokens) {
      throw new CircuitBreakerLimitError(
        `Token limit reached (${this.usage}/${this.maxTokens}). Reset or nuke before sending another request.`
      );
    }
    if (requestedTokens === undefined) {
      return;
    }
    if (!Number.isFinite(requestedTokens) || requestedTokens < 0) {
      throw new InvalidUsageReportError();
    }
    if (this.usage + Math.floor(requestedTokens) > this.maxTokens) {
      throw new CircuitBreakerLimitError(
        `Pre-flight estimate would exceed token limit (${this.usage} + ${Math.floor(
          requestedTokens
        )} > ${this.maxTokens}).`
      );
    }
  }

  reportUsage(tokens: number): void {
    if (!Number.isFinite(tokens) || tokens < 0) {
      throw new InvalidUsageReportError();
    }
    this.usage += Math.floor(tokens);
    this.storage.setItem(this.storageKey, String(this.usage));
  }

  getUsage(): number {
    return this.usage;
  }

  getMaxTokens(): number {
    return this.maxTokens;
  }

  setMaxTokens(maxTokens: number): void {
    const normalizedMaxTokens = normalizeTokenLimit(maxTokens, "maxTokens");
    if (normalizedMaxTokens < this.hardMinTokens) {
      throw new Error(
        `maxTokens must be greater than or equal to ${this.hardMinTokens}.`
      );
    }
    if (
      this.hardMaxTokens !== null &&
      normalizedMaxTokens > this.hardMaxTokens
    ) {
      throw new Error(
        `maxTokens must be less than or equal to ${this.hardMaxTokens}.`
      );
    }
    this.maxTokens = normalizedMaxTokens;
  }

  getHardMinTokens(): number {
    return this.hardMinTokens;
  }

  getHardMaxTokens(): number | null {
    return this.hardMaxTokens;
  }

  getRemainingTokens(): number {
    return Math.max(this.maxTokens - this.usage, 0);
  }

  reset(): void {
    this.usage = 0;
    this.storage.removeItem(this.storageKey);
  }
}

function normalizeTokenLimit(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a finite number greater than zero.`);
  }
  return Math.floor(value);
}
