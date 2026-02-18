import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test verifyToken which dynamically imports @clerk/backend.
// We'll manipulate process.env and mock the import.

describe('verifyToken', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('returns null when no token', async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_123';
    const { verifyToken } = await import('../auth.js');
    const result = await verifyToken(null);
    expect(result).toBeNull();
  });

  test('returns null when token is undefined', async () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_123';
    const { verifyToken } = await import('../auth.js');
    const result = await verifyToken(undefined);
    expect(result).toBeNull();
  });

  test('returns null when no CLERK_SECRET_KEY', async () => {
    delete process.env.CLERK_SECRET_KEY;
    const { verifyToken } = await import('../auth.js');
    const result = await verifyToken('some-token');
    expect(result).toBeNull();
  });

  test('returns null when CLERK_SECRET_KEY is empty', async () => {
    process.env.CLERK_SECRET_KEY = '';
    const { verifyToken } = await import('../auth.js');
    const result = await verifyToken('some-token');
    expect(result).toBeNull();
  });
});
