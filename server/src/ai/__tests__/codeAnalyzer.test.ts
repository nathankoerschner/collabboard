import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { FileTreeNode, RepoMetadata } from '../github.js';

const fetchFileHeadMock = vi.fn();
const fetchFileChunkMock = vi.fn();
const searchInFileMock = vi.fn();

vi.mock('../github.js', async () => {
  const actual = await vi.importActual<typeof import('../github.js')>('../github.js');
  return {
    ...actual,
    fetchFileHead: fetchFileHeadMock,
    fetchFileChunk: fetchFileChunkMock,
    searchInFile: searchInFileMock,
  };
});

async function loadAnalyzer() {
  return import('../codeAnalyzer.js');
}

describe('codeAnalyzer pipeline', () => {
  const metadata: RepoMetadata = {
    owner: 'acme',
    repo: 'app',
    description: 'demo',
    language: 'TypeScript',
    defaultBranch: 'main',
  };

  beforeEach(() => {
    vi.resetModules();
    fetchFileHeadMock.mockReset();
    fetchFileChunkMock.mockReset();
    searchInFileMock.mockReset();
    delete process.env.GITHUB_ANALYSIS_MAX_BYTES;
  });

  test('planner infers ERD from prompt intent', async () => {
    const { planRepoExploration, buildRepoBootstrapContext } = await loadAnalyzer();

    const tree: FileTreeNode[] = [
      { path: 'prisma/schema.prisma', type: 'blob', size: 200 },
      { path: 'src/index.ts', type: 'blob', size: 200 },
    ];

    const bootstrap = buildRepoBootstrapContext({
      metadata,
      tree,
      repoUrl: 'https://github.com/acme/app',
      branch: 'main',
    });

    const plan = planRepoExploration({
      promptWithoutUrl: 'make an erd for this repo',
      bootstrap,
      tree,
    });

    expect(plan.diagramType).toBe('erd');
    expect(plan.operations.length).toBeGreaterThan(0);
  });

  test('hard cap aborts retrieval round when byte budget is exceeded', async () => {
    const { executeExplorationRound } = await loadAnalyzer();

    const tree: FileTreeNode[] = [
      { path: 'src/index.ts', type: 'blob', size: 200 },
    ];

    fetchFileHeadMock.mockResolvedValue('a very long file head that exceeds tiny byte budget quickly');
    searchInFileMock.mockResolvedValue([]);

    const plan = {
      diagramType: 'architecture',
      questions: ['entrypoint?'],
      candidates: [{ path: 'src/index.ts', reason: 'entry', priority: 10 }],
      operations: [{ kind: 'head', path: 'src/index.ts', maxLines: 120 }],
      maxRounds: 2,
      maxFiles: 10,
      maxTokens: 5000,
      maxBytes: 20,
    };

    const state = {
      round: 1,
      scannedContents: [],
      touchedFiles: new Set<string>(),
      bytesFetched: 0,
      knownGaps: [],
      pendingOperations: [...plan.operations],
    };

    const round = await executeExplorationRound({
      promptWithoutUrl: 'architecture overview',
      repoUrl: 'https://github.com/acme/app',
      owner: 'acme',
      repo: 'app',
      branch: 'main',
      metadata,
      tree,
    }, plan, state);

    expect(round.hardCapError).toContain('byte budget exceeded');
  });

  test('buildRepoContextFromScannedContents records confidence and gaps', async () => {
    const { buildRepoContextFromScannedContents } = await loadAnalyzer();

    const context = buildRepoContextFromScannedContents({
      repoUrl: 'https://github.com/acme/app',
      diagramType: 'architecture',
      description: 'demo app',
      language: 'TypeScript',
      shallowTree: 'src/',
      scannedContents: [
        {
          path: 'src/index.ts',
          snippet: 'export const app = {}',
          reason: 'entrypoint',
          source: 'head',
        },
      ],
      knownGaps: ['missing env config'],
    });

    expect(context.confidence).toBe('low');
    expect(context.knownGaps).toEqual(['missing env config']);
    expect(context.scannedContents).toHaveLength(1);
  });
});
