import { readAIRateLimitConfig } from './featureFlags.js';

const buckets = new Map();

export function checkAIRateLimit(key) {
  const { limit, windowMs } = readAIRateLimitConfig();
  const now = Date.now();
  const bucketKey = key || 'anonymous';
  const bucket = buckets.get(bucketKey) || { count: 0, resetAt: now + windowMs };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  buckets.set(bucketKey, bucket);

  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    limit,
  };
}
