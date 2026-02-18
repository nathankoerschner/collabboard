import { Clerk } from '@clerk/clerk-js';

let clerk: Clerk | null = null;

export async function initAuth(): Promise<Clerk | null> {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
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

export function getUser(): { id: string; firstName?: string | null; fullName?: string | null } {
  if (!clerk) return { id: 'anonymous', firstName: 'Anonymous', fullName: 'Anonymous User' };
  return clerk.user!;
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
