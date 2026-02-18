let getTokenFn = null;

export function setTokenProvider(fn) {
  getTokenFn = fn;
}

async function fetchWithAuth(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
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

export function listBoards(userId) {
  return fetchWithAuth(`/api/boards?userId=${encodeURIComponent(userId)}`);
}

export function createBoard(data = {}) {
  return fetchWithAuth('/api/boards', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function renameBoard(id, name) {
  return fetchWithAuth(`/api/boards/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function deleteBoard(id) {
  return fetchWithAuth(`/api/boards/${id}`, {
    method: 'DELETE',
  });
}

export function runAICommand(boardId, payload) {
  return fetchWithAuth(`/api/boards/${encodeURIComponent(boardId)}/ai/command`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
