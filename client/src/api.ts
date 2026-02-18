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

export function listBoards(filter?: 'owned' | 'shared'): Promise<unknown> {
  const params = filter ? `?filter=${filter}` : '';
  return fetchWithAuth(`/api/boards${params}`);
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

// ─── Collaborators / Sharing ──────────────────────────────────────

export function getCollaborators(boardId: string): Promise<unknown> {
  return fetchWithAuth(`/api/boards/${encodeURIComponent(boardId)}/collaborators`);
}

export function addCollaborator(boardId: string, userId: string): Promise<unknown> {
  return fetchWithAuth(`/api/boards/${encodeURIComponent(boardId)}/collaborators`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export function removeCollaborator(boardId: string, userId: string): Promise<unknown> {
  return fetchWithAuth(`/api/boards/${encodeURIComponent(boardId)}/collaborators/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export function updateLinkSharing(boardId: string, enabled: boolean): Promise<unknown> {
  return fetchWithAuth(`/api/boards/${encodeURIComponent(boardId)}/sharing`, {
    method: 'PATCH',
    body: JSON.stringify({ link_sharing_enabled: enabled }),
  });
}

export function searchUsers(query: string): Promise<unknown> {
  return fetchWithAuth(`/api/users/search?q=${encodeURIComponent(query)}`);
}
