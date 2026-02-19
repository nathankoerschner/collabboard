import { Clerk } from '@clerk/clerk-js';

let clerk: Clerk | null = null;

async function resolvePublishableKey(): Promise<string | undefined> {
  if (typeof window !== 'undefined' && window.localStorage.getItem('collabboard.e2e.noAuth') === '1') {
    return undefined;
  }

  try {
    const res = await fetch('/api/runtime-config');
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.clerkPublishableKey === 'string' && data.clerkPublishableKey.trim()) {
        return data.clerkPublishableKey.trim();
      }
    }
  } catch {
    // Ignore runtime config fetch failures and fall back to build-time env.
  }

  return import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
}

export async function initAuth(): Promise<Clerk | null> {
  const publishableKey = await resolvePublishableKey();
  if (!publishableKey) {
    console.log('No Clerk key configured, running without auth');
    return null;
  }

  // Production keys (pk_live_) need proxy since we don't have a custom domain
  const isProduction = publishableKey.startsWith('pk_live_');
  clerk = new Clerk(publishableKey, isProduction ? { proxyUrl: '/__clerk' } as any : undefined);
  await clerk.load();
  return clerk;
}

export function getClerk(): Clerk | null {
  return clerk;
}

export function isSignedIn(): boolean {
  if (!clerk) return true; // No auth = always signed in
  return !!clerk.user;
}

export function getUser() {
  if (!clerk) return { id: 'anonymous', firstName: 'Anonymous', fullName: 'Anonymous User' };
  return clerk.user;
}

export async function getToken(): Promise<string | null> {
  if (!clerk?.session) return null;
  return clerk.session.getToken();
}

export function mountSignIn(el: HTMLElement | null): void {
  if (!clerk || !el) return;
  clerk.mountSignIn(el as HTMLDivElement);
}

export function mountUserButton(el: HTMLElement | null): void {
  if (!clerk || !el) return;
  clerk.mountUserButton(el as HTMLDivElement);
}

export async function signOut(): Promise<void> {
  if (!clerk) return;
  await clerk.signOut();
}
