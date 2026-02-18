function isTrue(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

export function isAIEnabled(): boolean {
  return isTrue(process.env.AI_FEATURE_ENABLED, false);
}

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export function readAIRateLimitConfig(): RateLimitConfig {
  return {
    limit: Math.max(1, Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 20)),
    windowMs: 60_000,
  };
}
