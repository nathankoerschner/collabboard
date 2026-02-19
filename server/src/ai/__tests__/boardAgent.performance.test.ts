import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';

const completionCreateMock = vi.fn();

vi.mock('openai', () => {
  const OpenAIMock = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: completionCreateMock,
      },
    },
  }));

  return {
    default: OpenAIMock,
  };
});

const doc = new Y.Doc();

type FrameObject = {
  id: string;
  type: 'frame';
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function framesOverlap(a: FrameObject, b: FrameObject): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

vi.mock('y-websocket/bin/utils', () => ({
  getYDoc: vi.fn(() => {
    (doc as Y.Doc & { whenInitialized?: Promise<void> }).whenInitialized = Promise.resolve();
    return doc;
  }),
}));

vi.mock('../observability.js', () => ({
  startAITrace: vi.fn(async () => ({ enabled: false })),
  recordLLMGeneration: vi.fn(async () => null),
  recordToolCall: vi.fn(async () => null),
  recordAIError: vi.fn(async () => null),
  finishAITrace: vi.fn(async () => null),
}));

describe('AI performance target', () => {
  beforeEach(() => {
    completionCreateMock.mockReset();
    doc.getMap('objects').clear();
    const zOrder = doc.getArray('zOrder');
    if (zOrder.length) zOrder.delete(0, zOrder.length);
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_MODEL = 'gpt-5.2';
  });

  test('single shape query executes in under 2 seconds', async () => {
    completionCreateMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              actions: [
                {
                  toolName: 'createShape',
                  args: { type: 'rectangle' },
                },
              ],
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 15,
        total_tokens: 65,
      },
    });

    const { executeBoardAICommand } = await import('../boardAgent.js');

    const result = await executeBoardAICommand({
      boardId: 'board-perf',
      prompt: 'create one rectangle shape',
      viewportCenter: { x: 0, y: 0 },
      userId: 'u1',
    });

    expect(result.createdIds.length).toBe(1);
    expect(result.plannerUsed).toBe(true);
    expect(result.durationMs).toBeLessThan(2000);
  });

  test('Create a SWOT analysis should place SWOT frames without overlap (currently failing regression)', async () => {
    // This mirrors the current broken behavior where the planner emits section frames
    // without explicit x/y positions, causing overlap from default placement spacing.
    completionCreateMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              actions: [
                { toolName: 'createFrame', args: { title: 'Strengths' } },
                { toolName: 'createFrame', args: { title: 'Weaknesses' } },
                { toolName: 'createFrame', args: { title: 'Opportunities' } },
                { toolName: 'createFrame', args: { title: 'Threats' } },
              ],
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 90,
        completion_tokens: 45,
        total_tokens: 135,
      },
    });

    const { executeBoardAICommand } = await import('../boardAgent.js');

    await executeBoardAICommand({
      boardId: 'board-swot-overlap-regression',
      prompt: 'Create a SWOT analysis',
      viewportCenter: { x: 0, y: 0 },
      userId: 'u1',
    });

    const frames = [...doc.getMap('objects').values()]
      .map((obj) => (obj as Y.Map<unknown>).toJSON())
      .filter((obj): obj is FrameObject => obj.type === 'frame')
      .map((obj) => ({
        ...obj,
        title: String(obj.title || ''),
        x: Number(obj.x || 0),
        y: Number(obj.y || 0),
        width: Number(obj.width || 0),
        height: Number(obj.height || 0),
      }));

    const byTitle = new Map(frames.map((frame) => [frame.title.toLowerCase(), frame]));
    const strengths = byTitle.get('strengths');
    const weaknesses = byTitle.get('weaknesses');
    const opportunities = byTitle.get('opportunities');
    const threats = byTitle.get('threats');

    expect(strengths).toBeTruthy();
    expect(weaknesses).toBeTruthy();
    expect(opportunities).toBeTruthy();
    expect(threats).toBeTruthy();

    const quadrants = [strengths!, weaknesses!, opportunities!, threats!];
    for (let i = 0; i < quadrants.length; i++) {
      for (let j = i + 1; j < quadrants.length; j++) {
        expect(framesOverlap(quadrants[i]!, quadrants[j]!)).toBe(false);
      }
    }
  });
});
