import OpenAI from 'openai';
// @ts-expect-error y-websocket/bin/utils has no types
import { getYDoc } from 'y-websocket/bin/utils';
import { BoardToolRunner } from './boardTools.js';
import { normalizeViewportCenter, toToolDefinitions } from './schema.js';
import { finishAITrace, recordAIError, recordLLMGeneration, recordToolCall, startAITrace } from './observability.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';
const MAX_TOOL_ROUNDS = 8;

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

function safeJsonParse(raw: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

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
    '5. Reserve ~24px margin on each side of a parent frame; usable area is (width - 48) x (height - 48).',
    '6. Keep every inner frame fully within the parent usable area.',
    '7. For multi-column layouts, ensure sum(column widths) + sum(gaps) <= parent usable width.',
    'This ensures a frames-within-frames structure that users can fill in themselves.',
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

    const tools = toToolDefinitions();
    const openai = getOpenAI();

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: JSON.stringify({
          prompt,
          viewportCenter: normalizedViewport,
        }),
      },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const llmStartedAt = Date.now();
      const completion = await openai.chat.completions.create({
        model: DEFAULT_MODEL,
        temperature: 0.1,
        tool_choice: 'auto',
        messages,
        tools,
      });

      const choice = completion.choices?.[0]?.message;
      if (!choice) break;

      await recordLLMGeneration(traceCtx, {
        model: DEFAULT_MODEL,
        input: messages,
        output: choice,
        usage: completion.usage,
        metadata: {
          round,
          durationMs: Date.now() - llmStartedAt,
          toolCallCount: choice.tool_calls?.length || 0,
        },
      });

      messages.push({
        role: 'assistant',
        content: choice.content || '',
        tool_calls: choice.tool_calls || undefined,
      } as ChatCompletionMessageParam);

      if (!choice.tool_calls?.length) {
        completed = true;
        break;
      }

      for (const toolCall of choice.tool_calls) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tc = toolCall as any;
        const toolName: string | undefined = tc.function?.name;
        const args = safeJsonParse(tc.function?.arguments, {});
        const toolStartedAt = Date.now();

        if (!toolName) {
          errors.push('Missing tool name in tool call');
          continue;
        }

        try {
          const result = toolRunner.invoke(toolName, args);
          await recordToolCall(traceCtx, {
            toolName,
            toolCallId: toolCall.id,
            round,
            args,
            result,
            durationMs: Date.now() - toolStartedAt,
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        } catch (err: unknown) {
          const message = `Tool ${toolName} failed: ${(err as Error).message}`;
          errors.push(message);
          await recordToolCall(traceCtx, {
            toolName,
            toolCallId: toolCall.id,
            round,
            args,
            result: null,
            error: message,
            durationMs: Date.now() - toolStartedAt,
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: message }),
          });
        }
      }
    }

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
