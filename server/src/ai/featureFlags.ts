export function readAIRateLimitConfig(): { limit: number; windowMs: number } {
  return {
    limit: Math.max(1, Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 20)),
    windowMs: 60_000,
  };
}
