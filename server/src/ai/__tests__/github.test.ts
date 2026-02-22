import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  fetchFileChunk,
  fetchFileHead,
  parseGitHubUrl,
  searchInFile,
  searchRepoPaths,
  type FileTreeNode,
} from '../github.js';

function mockGitHubJson(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

describe('github helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('parseGitHubUrl parses owner/repo/branch/path', () => {
    const parsed = parseGitHubUrl('https://github.com/acme/app/tree/main/src/server');
    expect(parsed).toEqual({
      owner: 'acme',
      repo: 'app',
      branch: 'main',
      path: 'src/server',
    });
  });

  test('searchRepoPaths respects scope', () => {
    const tree: FileTreeNode[] = [
      { path: 'src/server/index.ts', type: 'blob', size: 100 },
      { path: 'src/client/App.tsx', type: 'blob', size: 100 },
      { path: 'README.md', type: 'blob', size: 100 },
    ];

    const results = searchRepoPaths(tree, 'app', 'src/client');
    expect(results).toEqual(['src/client/App.tsx']);
  });

  test('fetchFileHead and fetchFileChunk return requested ranges', async () => {
    const content = ['one', 'two', 'three', 'four', 'five'].join('\n');
    const encoded = Buffer.from(content, 'utf-8').toString('base64');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockGitHubJson({ content: encoded, encoding: 'base64', size: content.length }),
    );

    const head = await fetchFileHead('acme', 'app', 'src/index.ts', 'main', 2);
    const chunk = await fetchFileChunk('acme', 'app', 'src/index.ts', 'main', 2, 4);

    expect(head).toBe('one\ntwo');
    expect(chunk).toBe('two\nthree\nfour');
  });

  test('searchInFile returns line matches', async () => {
    const content = ['alpha', 'beta todo item', 'gamma', 'todo second'].join('\n');
    const encoded = Buffer.from(content, 'utf-8').toString('base64');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockGitHubJson({ content: encoded, encoding: 'base64', size: content.length }),
    );

    const matches = await searchInFile('acme', 'app', 'notes.txt', 'main', 'todo', 5);
    expect(matches).toEqual([
      { line: 2, text: 'beta todo item' },
      { line: 4, text: 'todo second' },
    ]);
  });
});
