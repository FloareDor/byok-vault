import { CircuitBreakerLimitError, InvalidUsageReportError } from "./errors.js";

interface CircuitBreakerOptions {
  maxTokens: number;
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
  private readonly maxTokens: number;
  private readonly storage: Storage;
  private readonly storageKey: string;

  constructor(options: CircuitBreakerOptions) {
    if (!Number.isFinite(options.maxTokens) || options.maxTokens <= 0) {
      throw new Error("maxTokens must be a finite number greater than zero.");
    }
    this.maxTokens = Math.floor(options.maxTokens);
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

  getRemainingTokens(): number {
    return Math.max(this.maxTokens - this.usage, 0);
  }

  reset(): void {
    this.usage = 0;
    this.storage.removeItem(this.storageKey);
  }
}
