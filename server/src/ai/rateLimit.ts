import { readAIRateLimitConfig } from './featureFlags.js';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

const buckets = new Map<string, Bucket>();

export function checkAIRateLimit(key: string): RateLimitResult {
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
