let getTokenFn: (() => Promise<string | null>) | null = null;

export function setTokenProvider(fn: () => Promise<string | null>): void {
  getTokenFn = fn;
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) };
  if (getTokenFn) {
    const token = await getTokenFn();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error ? ` - ${body.error}` : '';
    } catch {
      // ignore
    }
    throw new Error(`API error: ${res.status}${detail}`);
  }
  return res.json();
}

export function getBoard(id: string): Promise<unknown> {
  return fetchWithAuth(`/api/boards/${encodeURIComponent(id)}`);
}

export function listBoards(userId: string): Promise<unknown> {
  return fetchWithAuth(`/api/boards?userId=${encodeURIComponent(userId)}`);
}

export function createBoard(data: Record<string, unknown> = {}): Promise<unknown> {
  return fetchWithAuth('/api/boards', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function renameBoard(id: string, name: string): Promise<unknown> {
  return fetchWithAuth(`/api/boards/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function deleteBoard(id: string): Promise<unknown> {
  return fetchWithAuth(`/api/boards/${id}`, {
    method: 'DELETE',
  });
}

export function duplicateBoard(id: string): Promise<unknown> {
  return fetchWithAuth(`/api/boards/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
  });
}

export function runAICommand(boardId: string, payload: Record<string, unknown>): Promise<unknown> {
  return fetchWithAuth(`/api/boards/${encodeURIComponent(boardId)}/ai/command`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
