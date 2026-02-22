import { beforeEach, describe, expect, test, vi } from 'vitest';

const bindToolsMock = vi.fn();
const invokeMock = vi.fn();
const toLangChainToolsMock = vi.fn();
const finishAITraceMock = vi.fn(async () => undefined);
const startAITraceMock = vi.fn(async () => ({ enabled: false }));
const getTraceCallbacksMock = vi.fn(async () => undefined);
const extractGitHubUrlMock = vi.fn();
const fetchRepoMetadataMock = vi.fn();
const fetchRepoTreeMock = vi.fn();
const runGitHubExplorationPipelineMock = vi.fn();
const buildRepoSystemPromptMock = vi.fn();

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn().mockImplementation(() => ({
    bindTools: bindToolsMock,
  })),
}));

vi.mock('y-websocket/bin/utils', () => ({
  getYDoc: vi.fn(() => ({ whenInitialized: Promise.resolve() })),
}));

vi.mock('../boardTools.js', () => ({
  BoardToolRunner: {
    fromYDoc: vi.fn(() => ({
      applyToDoc: vi.fn(() => ({
        createdIds: [],
        updatedIds: [],
        deletedIds: [],
        toolCalls: [],
      })),
    })),
  },
}));

vi.mock('../schema.js', () => ({
  normalizeViewportCenter: vi.fn(() => ({ x: 0, y: 0 })),
  toLangChainTools: toLangChainToolsMock,
}));

vi.mock('../observability.js', () => ({
  startAITrace: startAITraceMock,
  getTraceCallbacks: getTraceCallbacksMock,
  recordAIError: vi.fn(async () => undefined),
  finishAITrace: finishAITraceMock,
}));

vi.mock('../github.js', () => ({
  extractGitHubUrl: extractGitHubUrlMock,
  fetchRepoMetadata: fetchRepoMetadataMock,
  fetchRepoTree: fetchRepoTreeMock,
}));

vi.mock('../codeAnalyzer.js', () => ({
  runGitHubExplorationPipeline: runGitHubExplorationPipelineMock,
  buildRepoSystemPrompt: buildRepoSystemPromptMock,
}));

describe('boardAgent github phase gating', () => {
  beforeEach(() => {
    bindToolsMock.mockReset();
    invokeMock.mockReset();
    toLangChainToolsMock.mockReset();
    finishAITraceMock.mockClear();
    extractGitHubUrlMock.mockReset();
    fetchRepoMetadataMock.mockReset();
    fetchRepoTreeMock.mockReset();
    runGitHubExplorationPipelineMock.mockReset();
    buildRepoSystemPromptMock.mockReset();

    toLangChainToolsMock.mockReturnValue([{ name: 'createShape', invoke: vi.fn() }]);
    bindToolsMock.mockReturnValue({ invoke: invokeMock });
    invokeMock.mockResolvedValue({ tool_calls: [] });
  });

  test('non-GitHub prompt runs board phase directly', async () => {
    extractGitHubUrlMock.mockReturnValue(null);

    const { executeBoardAICommand } = await import('../boardAgent.js');
    const result = await executeBoardAICommand({
      boardId: 'b1',
      prompt: 'draw an architecture diagram',
      viewportCenter: { x: 0, y: 0 },
      userId: 'u1',
    });

    expect(result.completed).toBe(true);
    expect(runGitHubExplorationPipelineMock).not.toHaveBeenCalled();
    expect(bindToolsMock).toHaveBeenCalledTimes(1);

    const finishPayload = finishAITraceMock.mock.calls[0]?.[1];
    expect(finishPayload.githubAnalysis.urlDetected).toBe(false);
  });

  test('GitHub analysis hard failure skips diagram execution', async () => {
    extractGitHubUrlMock.mockReturnValue({
      url: 'https://github.com/acme/app',
      parsed: { owner: 'acme', repo: 'app' },
      promptWithoutUrl: 'diagram it',
    });
    fetchRepoMetadataMock.mockResolvedValue({
      owner: 'acme',
      repo: 'app',
      description: '',
      language: 'TypeScript',
      defaultBranch: 'main',
    });
    fetchRepoTreeMock.mockResolvedValue({ tree: [], branch: 'main' });
    runGitHubExplorationPipelineMock.mockResolvedValue({
      ok: false,
      userMessage: 'GitHub analysis stopped because file budget exceeded (26/25).',
      metrics: {
        urlDetected: true,
        repoToolsExposed: true,
        roundsUsed: 2,
        filesTouched: 26,
        bytesFetched: 1200,
        finalRepoContextTokens: 0,
        fallbackPathTaken: 'none',
        phaseLatenciesMs: { metadataTree: 5, planning: 10, retrieval: 50 },
      },
    });

    const { executeBoardAICommand } = await import('../boardAgent.js');
    const result = await executeBoardAICommand({
      boardId: 'b2',
      prompt: 'https://github.com/acme/app make a diagram',
      viewportCenter: { x: 0, y: 0 },
      userId: 'u1',
    });

    expect(result.completed).toBe(false);
    expect(result.createdIds).toEqual([]);
    expect(result.errors[0]).toContain('budget exceeded');
    expect(bindToolsMock).not.toHaveBeenCalled();

    const finishPayload = finishAITraceMock.mock.calls[0]?.[1];
    expect(finishPayload.githubAnalysis.urlDetected).toBe(true);
    expect(finishPayload.githubAnalysis.repoToolsExposed).toBe(true);
  });
});
