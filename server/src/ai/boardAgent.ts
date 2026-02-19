import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
// @ts-expect-error y-websocket/bin/utils has no types
import { getYDoc } from 'y-websocket/bin/utils';
import { BoardToolRunner } from './boardTools.js';
import { normalizeViewportCenter, toLangChainTools } from './schema.js';
import { finishAITrace, recordAIError, startAITrace } from './observability.js';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';
const MAX_TOOL_ROUNDS = 8;

function buildSystemPrompt(): string {
  return [
    'You are an AI whiteboard assistant.',
    'You MUST use provided tools for all board changes.',
    'Never invent IDs. Use IDs returned from tool results.',
    'Prefer getBoardState when object lookup is needed.',
    'Respect viewportCenter when placing new content; omit x/y to use deterministic placement near viewport center.',
    'Keep commands concise and deterministic.',
    '',
    'LAYOUT PATTERN: When creating structured boards (SWOT, retro, pros/cons, kanban, 2x2 matrix, etc.):',
    '1. Create ONE outer frame first to contain the full template layout.',
    '2. Create section/category frames INSIDE the outer frame, sized for user input.',
    '3. Use frame titles for labels (e.g. "Strengths", "What went well").',
    '4. Do NOT create seed stickies or prefilled notes unless the user explicitly asks for content.',
    '5. Frame title bar height is 32px; keep this reserved for label/selection behavior.',
    '6. Sticky-fit sizing rule (deterministic): size each input section frame to fit 6 default stickies in a 3x2 grid with fixed 24px gaps.',
    '7. Use sticky size 150x150, so required note area is 498x324 (3*150 + 2*24 by 2*150 + 24).',
    '8. Include 24px inner padding on all sides of that note area and keep it below the 32px title bar.',
    '9. Therefore, use minimum ACTUAL section frame size 546x404 to guarantee the 3x2 sticky layout fits.',
    '10. Placement rule: use ACTUAL frame dimensions (outer bounds) for all x/y placement and containment math.',
    '11. Deterministic spacing rule: use fixed 24px gaps between sibling frames and fixed 24px parent padding.',
    '12. Deterministic ordering rule: place sibling frames left-to-right, then top-to-bottom, with aligned top edges per row.',
    '13. For N equal columns inside a parent: columnWidth = floor((parentUsableWidth - (N - 1) * 24) / N).',
    '14. Outside-frame wrap rule: include ALL generated section-fill frames when computing outer bounds (every inner frame created for sections).',
    '15. Account for the outer frame title bar at the top: reserve 32px title bar + 24px top padding above inner content.',
    '16. Compute outer bounds deterministically from inner-frame extents: left = minInnerX - 24, top = minInnerY - (32 + 24), right = maxInnerRight + 24, bottom = maxInnerBottom + 24.',
    '17. Keep every inner frame fully within the parent usable area after applying the fixed-gap math.',
  ].join('\n');
}

interface AICommandInput {
  boardId: string;
  prompt: string;
  viewportCenter: unknown;
  userId: string;
}

interface AICommandResult {
  createdIds: string[];
  updatedIds: string[];
  deletedIds: string[];
  durationMs: number;
  completed: boolean;
  errors: string[];
}

export async function executeBoardAICommand({ boardId, prompt, viewportCenter, userId }: AICommandInput): Promise<AICommandResult> {
  const startedAt = Date.now();
  const normalizedViewport = normalizeViewportCenter(viewportCenter);
  const traceCtx = await startAITrace({ boardId, userId, prompt, viewportCenter: normalizedViewport });
  const errors: string[] = [];
  let completed = false;
  let mutationSummary = {
    createdIds: [] as string[],
    updatedIds: [] as string[],
    deletedIds: [] as string[],
    toolCalls: [] as Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>,
  };

  try {
    const yDoc = getYDoc(boardId);
    if (yDoc.whenInitialized) {
      await yDoc.whenInitialized;
    }

    const toolRunner = BoardToolRunner.fromYDoc(yDoc, {
      viewportCenter: normalizedViewport,
      actorId: `ai:${userId || 'anonymous'}`,
    });

    const llm = new ChatOpenAI({
      model: DEFAULT_MODEL,
      temperature: 0,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const tools = toLangChainTools(toolRunner);

    // eslint-disable-next-line deprecation/deprecation
    const agent = createReactAgent({
      llm,
      tools,
    });

    // Each round = 1 LLM call + 1 tool execution = 2 graph steps
    const result = await agent.invoke(
      {
        messages: [
          new SystemMessage(buildSystemPrompt()),
          new HumanMessage(JSON.stringify({
            prompt,
            viewportCenter: normalizedViewport,
          })),
        ],
      },
      { recursionLimit: MAX_TOOL_ROUNDS * 2 },
    );

    // Check if the agent completed (last message is from AI with no tool calls)
    const lastMessage = result.messages[result.messages.length - 1];
    completed = lastMessage?._getType?.() === 'ai' || lastMessage?.constructor?.name === 'AIMessage';

    mutationSummary = toolRunner.applyToDoc();
  } catch (err: unknown) {
    const message = (err as Error)?.message || 'Unknown AI execution error';
    errors.push(message);
    await recordAIError(traceCtx, {
      message,
      stack: (err as Error)?.stack,
      input: { boardId, prompt, viewportCenter: normalizedViewport },
      metadata: { boardId, userId },
    });
    throw err;
  } finally {
    const durationMs = Date.now() - startedAt;
    await finishAITrace(traceCtx, {
      createdIds: mutationSummary.createdIds,
      updatedIds: mutationSummary.updatedIds,
      deletedIds: mutationSummary.deletedIds,
      toolCalls: mutationSummary.toolCalls.map((entry) => ({
        toolName: entry.toolName,
        args: entry.args,
        result: entry.result,
      })),
      errors,
      durationMs,
      completed,
    });
  }

  const durationMs = Date.now() - startedAt;

  return {
    createdIds: mutationSummary.createdIds,
    updatedIds: mutationSummary.updatedIds,
    deletedIds: mutationSummary.deletedIds,
    durationMs,
    completed,
    errors,
  };
}
