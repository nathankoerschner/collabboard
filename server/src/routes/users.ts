import type { IncomingMessage, ServerResponse } from 'node:http';

const authEnabled = (): boolean => !!process.env.CLERK_SECRET_KEY;

let clerkClient: { users: { getUserList: (opts: { query: string; limit: number }) => Promise<{ data: Array<{ id: string; firstName: string | null; lastName: string | null; emailAddresses: Array<{ emailAddress: string }>; imageUrl: string | null }> }> } } | null = null;

async function loadClerkClient(): Promise<typeof clerkClient> {
  if (!process.env.CLERK_SECRET_KEY) return null;
  try {
    const clerk = await import('@clerk/backend');
    return clerk.createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  } catch {
    return null;
  }
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export async function handleUserRoutes(req: IncomingMessage, res: ServerResponse, userId: string | null): Promise<void | false> {
  const url = new URL(req.url!, `http://${req.headers.host}`);

  // GET /api/users/search?q=...
  if (req.method === 'GET' && url.pathname === '/api/users/search') {
    if (authEnabled() && !userId) return json(res, 401, { error: 'Authentication required' });

    const query = url.searchParams.get('q')?.trim() || '';
    if (query.length < 2) return json(res, 200, []);

    // Dev mode: no Clerk = empty results
    if (!process.env.CLERK_SECRET_KEY) return json(res, 200, []);

    if (!clerkClient) clerkClient = await loadClerkClient();
    if (!clerkClient) return json(res, 200, []);

    try {
      const response = await clerkClient.users.getUserList({ query, limit: 10 });
      const users = response.data || response;
      const results = (users as Array<{ id: string; firstName: string | null; lastName: string | null; emailAddresses: Array<{ emailAddress: string }>; imageUrl: string | null }>).map(u => ({
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.id,
        email: u.emailAddresses?.[0]?.emailAddress || '',
        image_url: u.imageUrl || null,
      }));
      return json(res, 200, results);
    } catch (err) {
      console.error('User search failed:', (err as Error).message);
      return json(res, 200, []);
    }
  }

  return false;
}
