import OpenAI from 'openai';
import { getYDoc } from 'y-websocket/bin/utils';
import { BoardToolRunner } from './boardTools.js';
import { normalizeViewportCenter, toToolDefinitions } from './schema.js';
import { finishAITrace, recordAIError, recordLLMGeneration, recordToolCall, startAITrace } from './observability.js';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TOOL_ROUNDS = 8;

let openaiClient = null;

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

function safeJsonParse(raw, fallback = {}) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function buildSystemPrompt() {
  return [
    'You are an AI whiteboard assistant.',
    'You MUST use provided tools for all board changes.',
    'Never invent IDs. Use IDs returned from tool results.',
    'Prefer getBoardState when object lookup is needed.',
    'Respect viewportCenter when placing new content; omit x/y to use deterministic placement near viewport center.',
    'Keep commands concise and deterministic.',
  ].join(' ');
}

export async function executeBoardAICommand({ boardId, prompt, viewportCenter, userId }) {
  const startedAt = Date.now();
  const normalizedViewport = normalizeViewportCenter(viewportCenter);
  const traceCtx = await startAITrace({ boardId, userId, prompt, viewportCenter: normalizedViewport });
  const errors = [];
  let completed = false;
  let mutationSummary = {
    createdIds: [],
    updatedIds: [],
    deletedIds: [],
    toolCalls: [],
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

    const messages = [
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
      });

      if (!choice.tool_calls?.length) {
        completed = true;
        break;
      }

      for (const toolCall of choice.tool_calls) {
        const toolName = toolCall.function?.name;
        const args = safeJsonParse(toolCall.function?.arguments, {});
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
        } catch (err) {
          const message = `Tool ${toolName} failed: ${err.message}`;
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
  } catch (err) {
    const message = err?.message || 'Unknown AI execution error';
    errors.push(message);
    await recordAIError(traceCtx, {
      message,
      stack: err?.stack,
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
