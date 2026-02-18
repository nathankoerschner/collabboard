function isTrue(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

export function isAIEnabled() {
  return isTrue(process.env.AI_FEATURE_ENABLED, false);
}

export function readAIRateLimitConfig() {
  return {
    limit: Math.max(1, Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 20)),
    windowMs: 60_000,
  };
}
