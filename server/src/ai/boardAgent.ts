import OpenAI from 'openai';
// @ts-expect-error y-websocket/bin/utils has no types
import { getYDoc } from 'y-websocket/bin/utils';
import { BoardToolRunner } from './boardTools.js';
import { normalizeViewportCenter, toToolDefinitions } from './schema.js';
import { finishAITrace, recordAIError, recordLLMGeneration, recordToolCall, startAITrace } from './observability.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const EXECUTION_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';
const PLANNER_MODEL = process.env.OPENAI_PLANNER_MODEL || 'gpt-4o-mini';
const PLANNER_MAX_TOKENS = Number(process.env.OPENAI_PLANNER_MAX_TOKENS || 220);
const BLOCKING_AI_TRACE = process.env.AI_TRACE_BLOCKING === 'true';
const MAX_TOOL_ROUNDS = 4;
const MAX_PLANNED_ACTIONS = 64;

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

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseJsonObjectLoose(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const candidates = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) candidates.push(fenced.trim());

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function buildSystemPrompt(): string {
  return [
    'You are an AI whiteboard assistant.',
    'Use tools for ALL board mutations. Never invent IDs.',
    'Prefer batch tools for repeated operations.',
    'Prefer scoped reads (getObjectById, listObjectsByType, getObjectsInViewport) over full board reads.',
    'When asked to create sections/columns, create one parent frame and one child frame per requested section title.',
    'If x/y omitted, placement is deterministic around viewportCenter.',
  ].join('\n');
}

function buildPlannerPrompt(toolNames: string[]): string {
  return [
    'Plan the board command as executable tool actions.',
    'Return JSON only with shape: {"actions":[{"toolName":"...","args":{}}]}.',
    `Use only these tool names: ${toolNames.join(', ')}.`,
    'Prefer batch tools when they fit the request.',
    'For section/column layouts, create one parent frame and one child frame per requested section title.',
    `Limit actions to ${MAX_PLANNED_ACTIONS}.`,
  ].join('\n');
}

function extractQuotedSectionTitles(prompt: string): string[] {
  const out: string[] = [];
  const re = /"([^"\n]{1,80})"/g;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(prompt))) {
    const title = match[1]?.trim();
    if (title) out.push(title);
  }
  return out.slice(0, 12);
}

function shouldAutoCreateSectionFrames(prompt: string, sectionTitles: string[]): boolean {
  if (sectionTitles.length < 2) return false;
  return /\b(section|sections|column|columns|board|chart|frame|frames)\b/i.test(prompt);
}

function parsePlannedActions(content: unknown): Array<{ toolName: string; args: Record<string, unknown> }> {
  if (typeof content !== 'string') return [];
  const parsed = parseJsonObjectLoose(content);
  if (!parsed) return [];

  const rawActions = Array.isArray(parsed.actions)
    ? parsed.actions
    : Array.isArray(parsed.steps)
      ? parsed.steps
      : Array.isArray(parsed.operations)
        ? parsed.operations
        : [];

  const actions: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  for (const entry of rawActions.slice(0, MAX_PLANNED_ACTIONS)) {
    const action = asObject(entry);
    const toolName = action.toolName ?? action.tool ?? action.name;
    if (typeof toolName !== 'string' || !toolName) continue;
    actions.push({
      toolName,
      args: asObject(action.args ?? action.arguments ?? action.parameters),
    });
  }
  return actions;
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
  llmRounds: number;
  plannerUsed: boolean;
  plannerActionCount: number;
}

export async function executeBoardAICommand({ boardId, prompt, viewportCenter, userId }: AICommandInput): Promise<AICommandResult> {
  const startedAt = Date.now();
  const normalizedViewport = normalizeViewportCenter(viewportCenter);
  const traceCtxPromise = startAITrace({ boardId, userId, prompt, viewportCenter: normalizedViewport });
  const traceCtx = BLOCKING_AI_TRACE ? await traceCtxPromise : { enabled: false };
  const trace = async (record: (ctx: Awaited<ReturnType<typeof startAITrace>>) => Promise<unknown>): Promise<void> => {
    if (BLOCKING_AI_TRACE) {
      await record(traceCtx);
      return;
    }
    void traceCtxPromise
      .then(async (ctx) => {
        await record(ctx);
      })
      .catch(() => undefined);
  };

  const errors: string[] = [];
  let completed = false;
  let plannerUsed = false;
  let plannerActionCount = 0;
  let llmRounds = 0;
  let usageTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
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
    const toolNameSet = new Set<string>(
      tools
        .map((tool) => {
          if (tool.type !== 'function') return null;
          return tool.function.name;
        })
        .filter((name): name is string => Boolean(name))
    );

    const sectionTitles = extractQuotedSectionTitles(prompt);
    if (shouldAutoCreateSectionFrames(prompt, sectionTitles)) {
      const sectionW = 546;
      const sectionH = 404;
      const gap = 24;
      const cols = Math.min(3, sectionTitles.length) || 1;
      const rows = Math.ceil(sectionTitles.length / cols);
      const contentWidth = cols * sectionW + (cols - 1) * gap;
      const contentHeight = rows * sectionH + (rows - 1) * gap;
      const startX = Math.round(normalizedViewport.x - contentWidth / 2);
      const startY = Math.round(normalizedViewport.y - contentHeight / 2);

      for (let i = 0; i < sectionTitles.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        toolRunner.invoke('createFrame', {
          title: sectionTitles[i],
          x: startX + col * (sectionW + gap),
          y: startY + row * (sectionH + gap),
          width: sectionW,
          height: sectionH,
        });
      }

      const outerPadding = 24;
      const outerTitleBarAndPadding = 56;
      toolRunner.invoke('createFrame', {
        title: 'Template',
        x: startX - outerPadding,
        y: startY - outerTitleBarAndPadding,
        width: contentWidth + outerPadding * 2,
        height: contentHeight + outerPadding + outerTitleBarAndPadding,
      });

      completed = true;
    }

    if (!completed) {
      const openai = getOpenAI();

      const plannerMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: buildPlannerPrompt([...toolNameSet]) },
        {
          role: 'user',
          content: JSON.stringify({
            prompt,
            viewportCenter: normalizedViewport,
          }),
        },
      ];

      try {
        const plannerStartedAt = Date.now();
        const plannerCompletion = await openai.chat.completions.create({
          model: PLANNER_MODEL,
          temperature: 0,
          response_format: { type: 'json_object' },
          max_tokens: PLANNER_MAX_TOKENS,
          messages: plannerMessages,
        });
        llmRounds += 1;
        usageTotals.inputTokens += plannerCompletion.usage?.prompt_tokens || 0;
        usageTotals.outputTokens += plannerCompletion.usage?.completion_tokens || 0;
        usageTotals.totalTokens += plannerCompletion.usage?.total_tokens || 0;

        const plannerChoice = plannerCompletion.choices?.[0]?.message;
        await trace((ctx) =>
          recordLLMGeneration(ctx, {
            model: PLANNER_MODEL,
            input: plannerMessages,
            output: plannerChoice,
            usage: plannerCompletion.usage,
            metadata: {
              phase: 'planner',
              durationMs: Date.now() - plannerStartedAt,
            },
          })
        );

        const plannedActions = parsePlannedActions(plannerChoice?.content);
        if (plannedActions.length > 0) {
          plannerUsed = true;
          plannerActionCount = plannedActions.length;

          for (let i = 0; i < plannedActions.length; i++) {
            const action = plannedActions[i]!;
            const toolStartedAt = Date.now();
            if (!toolNameSet.has(action.toolName)) {
              const error = `Planner emitted unsupported tool: ${action.toolName}`;
              errors.push(error);
              await trace((ctx) =>
                recordToolCall(ctx, {
                  toolName: action.toolName,
                  toolCallId: `planner-${i}`,
                  round: i,
                  args: action.args,
                  result: null,
                  error,
                  durationMs: Date.now() - toolStartedAt,
                })
              );
              continue;
            }

            try {
              const result = toolRunner.invoke(action.toolName, action.args);
              await trace((ctx) =>
                recordToolCall(ctx, {
                  toolName: action.toolName,
                  toolCallId: `planner-${i}`,
                  round: i,
                  args: action.args,
                  result,
                  durationMs: Date.now() - toolStartedAt,
                })
              );
            } catch (err: unknown) {
              const message = `Tool ${action.toolName} failed: ${(err as Error).message}`;
              errors.push(message);
              await trace((ctx) =>
                recordToolCall(ctx, {
                  toolName: action.toolName,
                  toolCallId: `planner-${i}`,
                  round: i,
                  args: action.args,
                  result: null,
                  error: message,
                  durationMs: Date.now() - toolStartedAt,
                })
              );
            }
          }

          completed = true;
        }
      } catch (plannerErr: unknown) {
        errors.push(`Planner stage failed: ${(plannerErr as Error).message}`);
      }

      if (!completed) {
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
            model: EXECUTION_MODEL,
            temperature: 0,
            tool_choice: 'auto',
            parallel_tool_calls: true,
            messages,
            tools,
          });
          llmRounds += 1;
          usageTotals.inputTokens += completion.usage?.prompt_tokens || 0;
          usageTotals.outputTokens += completion.usage?.completion_tokens || 0;
          usageTotals.totalTokens += completion.usage?.total_tokens || 0;

          const choice = completion.choices?.[0]?.message;
          if (!choice) break;

          await trace((ctx) =>
            recordLLMGeneration(ctx, {
              model: EXECUTION_MODEL,
              input: messages,
              output: choice,
              usage: completion.usage,
              metadata: {
                phase: 'tool_loop',
                round,
                durationMs: Date.now() - llmStartedAt,
                toolCallCount: choice.tool_calls?.length || 0,
              },
            })
          );

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
              await trace((ctx) =>
                recordToolCall(ctx, {
                  toolName,
                  toolCallId: toolCall.id,
                  round,
                  args,
                  result,
                  durationMs: Date.now() - toolStartedAt,
                })
              );
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
              });
            } catch (err: unknown) {
              const message = `Tool ${toolName} failed: ${(err as Error).message}`;
              errors.push(message);
              await trace((ctx) =>
                recordToolCall(ctx, {
                  toolName,
                  toolCallId: toolCall.id,
                  round,
                  args,
                  result: null,
                  error: message,
                  durationMs: Date.now() - toolStartedAt,
                })
              );
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: message }),
              });
            }
          }
        }
      }
    }

    mutationSummary = toolRunner.applyToDoc();
  } catch (err: unknown) {
    const message = (err as Error)?.message || 'Unknown AI execution error';
    errors.push(message);
    await trace((ctx) =>
      recordAIError(ctx, {
        message,
        stack: (err as Error)?.stack,
        input: { boardId, prompt, viewportCenter: normalizedViewport },
        metadata: { boardId, userId },
      })
    );
    throw err;
  } finally {
    const durationMs = Date.now() - startedAt;
    await trace((ctx) =>
      finishAITrace(ctx, {
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
        metrics: {
          llmRounds,
          plannerUsed,
          plannerActionCount,
          usage: usageTotals,
        },
      })
    );
  }

  const durationMs = Date.now() - startedAt;

  return {
    createdIds: mutationSummary.createdIds,
    updatedIds: mutationSummary.updatedIds,
    deletedIds: mutationSummary.deletedIds,
    durationMs,
    completed,
    errors,
    llmRounds,
    plannerUsed,
    plannerActionCount,
  };
}
