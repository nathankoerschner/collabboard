import { Clerk } from '@clerk/clerk-js';

let clerk: Clerk | null = null;

async function resolvePublishableKey(): Promise<string | undefined> {
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

  clerk = new Clerk(publishableKey);
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
