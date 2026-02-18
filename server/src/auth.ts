type VerifyTokenFn = (token: string, options: { secretKey: string }) => Promise<Record<string, unknown>>;

let clerkVerifyToken: VerifyTokenFn | null = null;

async function loadClerk(): Promise<VerifyTokenFn | null> {
  if (!process.env.CLERK_SECRET_KEY) return null;
  try {
    const clerk = await import('@clerk/backend');
    return clerk.verifyToken as unknown as VerifyTokenFn;
  } catch {
    console.warn('Clerk backend not available');
    return null;
  }
}

export async function verifyToken(token: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  if (!process.env.CLERK_SECRET_KEY) return null;

  if (!clerkVerifyToken) {
    clerkVerifyToken = await loadClerk();
  }
  if (!clerkVerifyToken) return null;

  try {
    const payload = await clerkVerifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    return payload;
  } catch (err) {
    console.warn('Token verification failed:', (err as Error).message);
    return null;
  }
}
