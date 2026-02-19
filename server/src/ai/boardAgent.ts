import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { AIMessage } from '@langchain/core/messages';
// @ts-expect-error y-websocket/bin/utils has no types
import { getYDoc } from 'y-websocket/bin/utils';
import { BoardToolRunner } from './boardTools.js';
import { normalizeViewportCenter, toLangChainTools } from './schema.js';
import { finishAITrace, recordAIError, startAITrace, withCollapsedLangChainTracing } from './observability.js';

const FAST_MODEL = process.env.OPENAI_FAST_MODEL || 'gpt-4o-mini';
const POWER_MODEL = process.env.OPENAI_MODEL || 'gpt-5.2';
const MAX_TOOL_ROUNDS = 8;

function buildSystemPrompt(): string {
  return [
    'You are an AI whiteboard assistant.',
    'You MUST use provided tools for all board changes.',
    'Never invent IDs. Use IDs returned from tool results.',
    'Prefer getBoardState when object lookup is needed.',
    'Respect viewportCenter when placing new content; omit x/y to use deterministic placement near viewport center.',
    'Interpret user-specified coordinates (e.g. "position 100, 200") as viewport pixel coordinates from the caller\'s visible top-left unless the user explicitly says absolute/world coordinates.',
    'Keep commands concise.',
    'If selectedObjectIds is provided in the user payload and the request references "selected", operate on those IDs only.',
    'For structured templates (SWOT/retro/kanban/matrix), create one outer frame plus labeled inner section frames and avoid seed content unless asked.',
    'When creating frames, follow the deterministic sizing/spacing rules from the tool descriptions.',
  ].join('\n');
}

interface AICommandInput {
  boardId: string;
  prompt: string;
  viewportCenter: unknown;
  selectedObjectIds?: string[];
  userId: string;
}

interface ViewportContext {
  center: { x: number; y: number };
  widthPx: number | null;
  heightPx: number | null;
  topLeftWorld: { x: number; y: number } | null;
  bottomRightWorld: { x: number; y: number } | null;
  scale: number | null;
}

interface AICommandResult {
  createdIds: string[];
  updatedIds: string[];
  deletedIds: string[];
  durationMs: number;
  completed: boolean;
  errors: string[];
}

function normalizeViewportContext(input: unknown): ViewportContext {
  const center = normalizeViewportCenter(input);
  const obj = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const widthPx = typeof obj.widthPx === 'number' && Number.isFinite(obj.widthPx) && obj.widthPx > 0 ? obj.widthPx : null;
  const heightPx = typeof obj.heightPx === 'number' && Number.isFinite(obj.heightPx) && obj.heightPx > 0 ? obj.heightPx : null;
  const scale = typeof obj.scale === 'number' && Number.isFinite(obj.scale) && obj.scale > 0 ? obj.scale : null;
  const topLeft = obj.topLeftWorld && typeof obj.topLeftWorld === 'object' ? obj.topLeftWorld as Record<string, unknown> : null;
  const bottomRight = obj.bottomRightWorld && typeof obj.bottomRightWorld === 'object' ? obj.bottomRightWorld as Record<string, unknown> : null;
  const topLeftWorld = topLeft && typeof topLeft.x === 'number' && typeof topLeft.y === 'number'
    ? { x: topLeft.x, y: topLeft.y }
    : null;
  const bottomRightWorld = bottomRight && typeof bottomRight.x === 'number' && typeof bottomRight.y === 'number'
    ? { x: bottomRight.x, y: bottomRight.y }
    : null;
  return { center, widthPx, heightPx, topLeftWorld, bottomRightWorld, scale };
}

export async function executeBoardAICommand({ boardId, prompt, viewportCenter, selectedObjectIds, userId }: AICommandInput): Promise<AICommandResult> {
  const startedAt = Date.now();
  const viewport = normalizeViewportContext(viewportCenter);
  const traceCtx = await startAITrace({ boardId, userId, prompt, viewportCenter: viewport });
  const errors: string[] = [];
  let completed = false;
  const modelsUsed = new Set<string>();
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
      viewportCenter: viewport.center,
      actorId: `ai:${userId || 'anonymous'}`,
    });

    const fastLlm = new ChatOpenAI({
      model: FAST_MODEL,
      temperature: 0,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
    const powerLlm = new ChatOpenAI({
      model: POWER_MODEL,
      temperature: 0,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    const tools = toLangChainTools(toolRunner);

    const LAYOUT_TOOLS = new Set(['createFrame', 'arrangeObjectsInGrid']);

    const messages: BaseMessage[] = [
      new SystemMessage(buildSystemPrompt()),
      new HumanMessage(JSON.stringify({
        prompt,
        viewportCenter: viewport,
        selectedObjectIds: selectedObjectIds || [],
      })),
    ];

    let needsPowerModel = false;

    await withCollapsedLangChainTracing(async () => {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const model = needsPowerModel ? POWER_MODEL : FAST_MODEL;
        const llm = needsPowerModel ? powerLlm : fastLlm;
        modelsUsed.add(model);

        const response = await llm.bindTools(tools).invoke(messages, {
          metadata: { model, round },
          tags: [`model:${model}`, `round:${round}`],
          runName: `round_${round}_${model}`,
        }) as AIMessage;
        messages.push(response);

        const toolCalls = response.tool_calls ?? [];

        if (toolCalls.length === 0) {
          completed = true;
          break;
        }

        // Escalate to power model if layout tools are invoked
        if (!needsPowerModel && toolCalls.some((tc) => LAYOUT_TOOLS.has(tc.name))) {
          needsPowerModel = true;
        }

        for (const toolCall of toolCalls) {
          const tool = tools.find((t) => t.name === toolCall.name);
          const result = tool
            ? await tool.invoke(toolCall.args)
            : JSON.stringify({ error: `Unknown tool: ${toolCall.name}` });
          messages.push(new ToolMessage({
            content: typeof result === 'string' ? result : JSON.stringify(result),
            tool_call_id: toolCall.id!,
            name: toolCall.name,
          }));
        }
      }
    });

    mutationSummary = toolRunner.applyToDoc();
  } catch (err: unknown) {
    const message = (err as Error)?.message || 'Unknown AI execution error';
    errors.push(message);
    await recordAIError(traceCtx, {
      message,
      stack: (err as Error)?.stack,
      input: { boardId, prompt, viewportCenter: viewport },
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
      modelsUsed: [...modelsUsed],
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
