import type { AICommandRequest, AICommandResponse, BoardRecord, CreateBoardRequest } from '../../shared/types.js';

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

export function listBoards(userId: string): Promise<BoardRecord[]> {
  return fetchWithAuth(`/api/boards?userId=${encodeURIComponent(userId)}`) as Promise<BoardRecord[]>;
}

export function createBoard(data: CreateBoardRequest = {}): Promise<BoardRecord> {
  return fetchWithAuth('/api/boards', {
    method: 'POST',
    body: JSON.stringify(data),
  }) as Promise<BoardRecord>;
}

export function renameBoard(id: string, name: string): Promise<{ ok: boolean }> {
  return fetchWithAuth(`/api/boards/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  }) as Promise<{ ok: boolean }>;
}

export function deleteBoard(id: string): Promise<{ ok: boolean }> {
  return fetchWithAuth(`/api/boards/${id}`, {
    method: 'DELETE',
  }) as Promise<{ ok: boolean }>;
}

export function runAICommand(boardId: string, payload: AICommandRequest): Promise<AICommandResponse> {
  return fetchWithAuth(`/api/boards/${encodeURIComponent(boardId)}/ai/command`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as Promise<AICommandResponse>;
}
