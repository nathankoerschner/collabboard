import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const doc = new Y.Doc();

vi.mock('y-websocket/bin/utils', () => ({
  getYDoc: vi.fn(() => {
    (doc as Y.Doc & { whenInitialized?: Promise<void> }).whenInitialized = Promise.resolve();
    return doc;
  }),
}));

vi.mock('../observability.js', () => ({
  startAITrace: vi.fn(async () => ({ enabled: false })),
  withCollapsedLangChainTracing: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  recordLLMGeneration: vi.fn(async () => null),
  recordToolCall: vi.fn(async () => null),
  recordAIError: vi.fn(async () => null),
  finishAITrace: vi.fn(async () => null),
}));

type FrameObject = {
  id: string;
  type: 'frame';
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function isContainedBy(inner: FrameObject, outer: FrameObject): boolean {
  const innerRight = inner.x + inner.width;
  const innerBottom = inner.y + inner.height;
  const outerRight = outer.x + outer.width;
  const outerBottom = outer.y + outer.height;
  return inner.x >= outer.x && inner.y >= outer.y && innerRight <= outerRight && innerBottom <= outerBottom;
}

function framesOverlap(a: FrameObject, b: FrameObject): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

let judgeClient: OpenAI | null = null;

function getJudgeClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for AI semantic title checks');
  }
  if (!judgeClient) {
    judgeClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return judgeClient;
}

type TitleJudgeResult = {
  wentWell: boolean;
  couldBeBetter: boolean;
  oneThing: boolean;
};

function parseJudgeResult(raw: string): TitleJudgeResult {
  try {
    const parsed = JSON.parse(raw) as Partial<TitleJudgeResult>;
    return {
      wentWell: Boolean(parsed.wentWell),
      couldBeBetter: Boolean(parsed.couldBeBetter),
      oneThing: Boolean(parsed.oneThing),
    };
  } catch {
    return {
      wentWell: false,
      couldBeBetter: false,
      oneThing: false,
    };
  }
}

async function evaluateTitleSimilarityWithAI(titles: string[]): Promise<TitleJudgeResult> {
  const openai = getJudgeClient();
  const model = process.env.OPENAI_JUDGE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    max_tokens: 120,
    messages: [
      {
        role: 'system',
        content: [
          'You evaluate semantic similarity for retrospective board section titles.',
          'Return JSON only with booleans: {"wentWell":true|false,"couldBeBetter":true|false,"oneThing":true|false}.',
          'Accept paraphrases, minor spelling issues, and close wording.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          expectedIntents: [
            'What went well',
            'What could have gone better',
            "What's the one thing?",
          ],
          actualTitles: titles,
        }),
      },
    ],
  });

  const content = completion.choices?.[0]?.message?.content || '';
  return parseJudgeResult(content);
}

describe('AI behavior regression', () => {
  beforeEach(() => {
    doc.getMap('objects').clear();
    const zOrder = doc.getArray('zOrder');
    if (zOrder.length) zOrder.delete(0, zOrder.length);
  });

  test.skipIf(!process.env.OPENAI_API_KEY)(
    'prompt creates one parent frame with three section frames named like the prompt',
    async () => {
      process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';

      const { executeBoardAICommand } = await import('../boardAgent.js');

      await executeBoardAICommand({
        boardId: 'board-live-retro-behavior',
        prompt: 'create a chart with "what went well" "what could have gone better" and "what\'s the one thing?" sections',
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

      expect(frames.length).toBeGreaterThanOrEqual(4);

      const outer = [...frames].sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
      const innerFrames = frames.filter((frame) => frame.id !== outer.id && isContainedBy(frame, outer));

      expect(innerFrames.length).toBe(3);

      const innerTitles = innerFrames.map((frame) => frame.title);
      const judged = await evaluateTitleSimilarityWithAI(innerTitles);
      expect(judged.wentWell).toBe(true);
      expect(judged.couldBeBetter).toBe(true);
      expect(judged.oneThing).toBe(true);
    },
    90_000
  );

  test.skipIf(!process.env.OPENAI_API_KEY)(
    'Create a SWOT analysis places SWOT frames in a non-overlapping 2x2 layout',
    async () => {
      process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';

      const { executeBoardAICommand } = await import('../boardAgent.js');

      await executeBoardAICommand({
        boardId: 'board-live-swot-layout',
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

      const uniqueXs = [...new Set(quadrants.map((frame) => frame.x))].sort((a, b) => a - b);
      const uniqueYs = [...new Set(quadrants.map((frame) => frame.y))].sort((a, b) => a - b);
      expect(uniqueXs.length).toBe(2);
      expect(uniqueYs.length).toBe(2);

      const leftFrames = quadrants.filter((frame) => frame.x === uniqueXs[0]);
      const rightFrames = quadrants.filter((frame) => frame.x === uniqueXs[1]);
      const topFrames = quadrants.filter((frame) => frame.y === uniqueYs[0]);
      const bottomFrames = quadrants.filter((frame) => frame.y === uniqueYs[1]);
      expect(leftFrames.length).toBe(2);
      expect(rightFrames.length).toBe(2);
      expect(topFrames.length).toBe(2);
      expect(bottomFrames.length).toBe(2);

      const leftMaxRight = Math.max(...leftFrames.map((frame) => frame.x + frame.width));
      const rightMinX = Math.min(...rightFrames.map((frame) => frame.x));
      const topMaxBottom = Math.max(...topFrames.map((frame) => frame.y + frame.height));
      const bottomMinY = Math.min(...bottomFrames.map((frame) => frame.y));
      expect(rightMinX - leftMaxRight).toBeGreaterThanOrEqual(0);
      expect(bottomMinY - topMaxBottom).toBeGreaterThanOrEqual(0);
    },
    90_000
  );

  test.skipIf(!process.env.OPENAI_API_KEY)(
    'Create a SWOT analysis creates quadrant frames larger than a sticky note',
    async () => {
      process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';

      const { executeBoardAICommand } = await import('../boardAgent.js');

      await executeBoardAICommand({
        boardId: 'board-live-swot-size',
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
          width: Number(obj.width || 0),
          height: Number(obj.height || 0),
        }));

      const byTitle = new Map(frames.map((frame) => [frame.title.toLowerCase(), frame]));
      const quadrants = [
        byTitle.get('strengths'),
        byTitle.get('weaknesses'),
        byTitle.get('opportunities'),
        byTitle.get('threats'),
      ];

      for (const quadrant of quadrants) {
        expect(quadrant).toBeTruthy();
        expect(quadrant!.width).toBeGreaterThan(300);
        expect(quadrant!.height).toBeGreaterThan(300);
      }
    },
    90_000
  );

  test.skipIf(!process.env.OPENAI_API_KEY)(
    'Create a SWOT analysis outputs five total frames with four inside one outer frame',
    async () => {
      process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';

      const { executeBoardAICommand } = await import('../boardAgent.js');

      await executeBoardAICommand({
        boardId: 'board-live-swot-five-frames',
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

      expect(frames.length).toBe(5);

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
      const outerCandidates = frames.filter((frame) => !quadrants.some((quadrant) => quadrant.id === frame.id));
      expect(outerCandidates.length).toBe(1);

      const outer = outerCandidates[0]!;
      for (const quadrant of quadrants) {
        expect(isContainedBy(quadrant, outer)).toBe(true);
      }
    },
    90_000
  );
});
