import type { BoardRole } from './permissions.js';

interface CacheEntry {
  role: BoardRole;
  expiresAt: number;
}

const TTL_MS = 60_000; // 60 seconds
const cache = new Map<string, CacheEntry>();

function key(boardId: string, userId: string): string {
  return `${boardId}:${userId}`;
}

export function getCachedRole(boardId: string, userId: string): BoardRole | undefined {
  const entry = cache.get(key(boardId, userId));
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key(boardId, userId));
    return undefined;
  }
  return entry.role;
}

export function setCachedRole(boardId: string, userId: string, role: BoardRole): void {
  cache.set(key(boardId, userId), { role, expiresAt: Date.now() + TTL_MS });
}

export function invalidateBoard(boardId: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(`${boardId}:`)) cache.delete(k);
  }
}

export function invalidateUser(userId: string): void {
  for (const k of cache.keys()) {
    if (k.endsWith(`:${userId}`)) cache.delete(k);
  }
}
