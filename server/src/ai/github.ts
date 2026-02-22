/**
 * GitHub API client for fetching public repo structure and file contents.
 */

const GITHUB_API = 'https://api.github.com';
const FETCH_TIMEOUT = Number(process.env.GITHUB_FETCH_TIMEOUT) || 30_000;
const MAX_FILE_SIZE = Number(process.env.GITHUB_MAX_FILE_SIZE) || 102_400; // 100KB
const DEFAULT_HEAD_LINES = 160;
const DEFAULT_MAX_MATCHES = 25;

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
}

export interface FileTreeNode {
  path: string;
  type: 'blob' | 'tree';
  size: number;
}

export interface RepoMetadata {
  owner: string;
  repo: string;
  description: string;
  language: string;
  defaultBranch: string;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'CollabBoard-AI',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function githubFetch(path: string): Promise<Response> {
  const url = `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404) throw new GitHubError('Repository not found or is private.', 404);
    if (res.status === 403 || res.status === 429) throw new GitHubError('GitHub API rate limit exceeded. Try again later or set GITHUB_TOKEN.', res.status);
    throw new GitHubError(`GitHub API error ${res.status}: ${body.slice(0, 200)}`, res.status);
  }
  return res;
}

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

function normalizeScopedPath(path?: string): string | undefined {
  if (!path) return undefined;
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

function filterTreeByScope(tree: FileTreeNode[], scope?: string): FileTreeNode[] {
  const scoped = normalizeScopedPath(scope);
  if (!scoped) return tree;
  const prefix = `${scoped}/`;
  return tree.filter((node) => node.path === scoped || node.path.startsWith(prefix));
}

function isLikelyBinaryOrMinified(content: string): boolean {
  if (!content) return false;
  if (content.includes('\u0000')) return true;

  const lines = content.split(/\r?\n/);
  const longLine = lines.some((line) => line.length > 1200);
  if (longLine && lines.length <= 8) return true;

  const printable = content.replace(/[\x09\x0A\x0D\x20-\x7E]/g, '');
  return printable.length / content.length > 0.2;
}

/**
 * Parse a GitHub URL into owner/repo/branch/path components.
 * Accepts:
 *   github.com/owner/repo
 *   github.com/owner/repo/tree/branch
 *   github.com/owner/repo/tree/branch/path/to/dir
 */
export function parseGitHubUrl(input: string): ParsedGitHubUrl | null {
  const trimmed = input.trim();
  const match = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?/,
  );
  if (!match) return null;

  const [, owner, repo, branch, path] = match;
  return {
    owner: owner!,
    repo: repo!.replace(/\.git$/, ''),
    branch: branch || undefined,
    path: normalizeScopedPath(path),
  };
}

/**
 * Extract a GitHub URL from a prompt string (if present).
 */
export function extractGitHubUrl(prompt: string): { url: string; parsed: ParsedGitHubUrl; promptWithoutUrl: string } | null {
  const urlMatch = prompt.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_.\-/]+/);
  if (!urlMatch) return null;

  const parsed = parseGitHubUrl(urlMatch[0]);
  if (!parsed) return null;

  const promptWithoutUrl = prompt.replace(urlMatch[0], '').trim();
  return { url: urlMatch[0], parsed, promptWithoutUrl };
}

/**
 * Fetch repository metadata (description, language, default branch).
 */
export async function fetchRepoMetadata(owner: string, repo: string): Promise<RepoMetadata> {
  const res = await githubFetch(`/repos/${owner}/${repo}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    owner,
    repo,
    description: (data.description as string) || '',
    language: (data.language as string) || 'Unknown',
    defaultBranch: (data.default_branch as string) || 'main',
  };
}

/**
 * Fetch the full file tree of a repo recursively.
 */
export async function fetchRepoTree(
  owner: string,
  repo: string,
  branch?: string,
  scopedPath?: string,
): Promise<{ tree: FileTreeNode[]; branch: string }> {
  let resolvedBranch = branch;
  if (!resolvedBranch) {
    const meta = await fetchRepoMetadata(owner, repo);
    resolvedBranch = meta.defaultBranch;
  }

  const res = await githubFetch(`/repos/${owner}/${repo}/git/trees/${resolvedBranch}?recursive=1`);
  const data = await res.json() as { tree: Array<{ path: string; type: string; size?: number }> };

  const tree: FileTreeNode[] = (data.tree || [])
    .filter((node) => node.type === 'blob' || node.type === 'tree')
    .map((node) => ({
      path: node.path,
      type: node.type as 'blob' | 'tree',
      size: node.size || 0,
    }));

  return { tree: filterTreeByScope(tree, scopedPath), branch: resolvedBranch };
}

async function fetchFileText(owner: string, repo: string, path: string, branch: string): Promise<{ text: string; size: number } | null> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const res = await githubFetch(`/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`);
  const data = await res.json() as { content?: string; encoding?: string; size?: number };

  if (typeof data.size === 'number' && data.size > MAX_FILE_SIZE) return null;
  if (data.encoding !== 'base64' || !data.content) return null;

  const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
  if (isLikelyBinaryOrMinified(decoded)) return null;

  return {
    text: decoded,
    size: typeof data.size === 'number' ? data.size : Buffer.byteLength(decoded, 'utf-8'),
  };
}

/**
 * Fetch file head lines.
 */
export async function fetchFileHead(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  maxLines = DEFAULT_HEAD_LINES,
): Promise<string | null> {
  const content = await fetchFileText(owner, repo, path, branch);
  if (!content) return null;
  return content.text.split(/\r?\n/).slice(0, Math.max(1, maxLines)).join('\n');
}

/**
 * Fetch file chunk by line range (inclusive).
 */
export async function fetchFileChunk(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  startLine: number,
  endLine: number,
): Promise<string | null> {
  const content = await fetchFileText(owner, repo, path, branch);
  if (!content) return null;
  const lines = content.text.split(/\r?\n/);
  const start = Math.max(1, Math.floor(startLine));
  const end = Math.max(start, Math.floor(endLine));
  return lines.slice(start - 1, end).join('\n');
}

/**
 * Search file paths from repository tree.
 */
export function searchRepoPaths(tree: FileTreeNode[], query: string, scope?: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const scoped = filterTreeByScope(tree, scope).filter((node) => node.type === 'blob');

  const tokens = normalized.split(/\s+/).filter(Boolean);
  return scoped
    .map((node) => {
      const lowerPath = node.path.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (lowerPath.includes(token)) score += 3;
        if (lowerPath.endsWith(token)) score += 2;
      }
      const basename = lowerPath.split('/').pop() || lowerPath;
      if (tokens.some((token) => basename.includes(token))) score += 2;
      return { path: node.path, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((entry) => entry.path);
}

/**
 * Search text in a specific file.
 */
export async function searchInFile(
  owner: string,
  repo: string,
  path: string,
  branch: string,
  query: string,
  maxMatches = DEFAULT_MAX_MATCHES,
): Promise<Array<{ line: number; text: string }>> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const content = await fetchFileText(owner, repo, path, branch);
  if (!content) return [];

  const lines = content.text.split(/\r?\n/);
  const matches: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.toLowerCase().includes(normalized)) {
      matches.push({ line: i + 1, text: line.slice(0, 500) });
      if (matches.length >= Math.max(1, maxMatches)) break;
    }
  }
  return matches;
}

/**
 * Fetch contents of specific files. Skips files over MAX_FILE_SIZE and binary/minified content.
 */
export async function fetchFileContents(
  owner: string,
  repo: string,
  paths: string[],
  branch: string,
): Promise<Map<string, string>> {
  const maxFiles = Number(process.env.GITHUB_MAX_FILES) || 30;
  const filesToFetch = paths.slice(0, maxFiles);
  const results = new Map<string, string>();

  const concurrency = 6;
  for (let i = 0; i < filesToFetch.length; i += concurrency) {
    const batch = filesToFetch.slice(i, i + concurrency);
    await Promise.all(batch.map(async (filePath) => {
      try {
        const content = await fetchFileText(owner, repo, filePath, branch);
        if (!content) return;
        results.set(filePath, content.text);
      } catch {
        // Best effort.
      }
    }));
  }

  return results;
}

/**
 * Build an ASCII directory tree string (truncated to maxDepth).
 */
export function buildDirectoryTree(tree: FileTreeNode[], maxDepth = 3): string {
  const dirs = new Set<string>();
  const files: string[] = [];

  for (const node of tree) {
    const parts = node.path.split('/');
    if (parts.length - 1 > maxDepth) continue;

    if (node.type === 'tree') {
      dirs.add(node.path);
    } else if (parts.length <= maxDepth + 1) {
      files.push(node.path);
    }
  }

  const allPaths = [...dirs, ...files].sort();
  const lines: string[] = [];

  for (const p of allPaths) {
    const depth = p.split('/').length - 1;
    if (depth > maxDepth) continue;
    const indent = '  '.repeat(depth);
    const name = p.split('/').pop()!;
    const isDir = dirs.has(p);
    lines.push(`${indent}${isDir ? `${name}/` : name}`);
  }

  return lines.join('\n');
}
