import { randomUUID } from 'node:crypto';
import { Client as LangSmithClient } from 'langsmith';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';

interface TraceInput {
  boardId: string;
  userId: string;
  prompt: string;
  viewportCenter: unknown;
}

export interface TraceContext {
  enabled: boolean;
  rootRunId?: string;
  tracer?: LangChainTracer;
}

let sharedClient: LangSmithClient | null = null;
let sharedTracer: LangChainTracer | null = null;

function isTracingEnabled(): boolean {
  const tracingFlag = process.env.LANGSMITH_TRACING === 'true' || process.env.LANGCHAIN_TRACING_V2 === 'true';
  return tracingFlag && Boolean(process.env.LANGSMITH_API_KEY);
}

function getProjectName(): string {
  return process.env.LANGSMITH_PROJECT || 'default';
}

function shouldRedactPrompt(): boolean {
  return process.env.LANGSMITH_REDACT_PROMPT !== 'false';
}

function getLangSmithClient(): LangSmithClient {
  if (sharedClient) return sharedClient;
  sharedClient = new LangSmithClient({
    apiKey: process.env.LANGSMITH_API_KEY,
    apiUrl: process.env.LANGSMITH_ENDPOINT,
  });
  return sharedClient;
}

function getLangChainTracer(): LangChainTracer {
  if (sharedTracer) return sharedTracer;
  sharedTracer = new LangChainTracer({
    client: getLangSmithClient(),
    projectName: getProjectName(),
  });
  return sharedTracer;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

async function safeTraceCall(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    // Tracing must never fail the AI command path.
    console.warn('[langsmith] tracing operation failed:', (err as Error)?.message || String(err));
  }
}

export async function startAITrace(input: TraceInput): Promise<TraceContext> {
  const enabled = isTracingEnabled();
  if (!enabled) {
    return { enabled: false };
  }

  const rootRunId = randomUUID();
  const prompt = shouldRedactPrompt() ? '[redacted]' : input.prompt;
  await safeTraceCall(async () => {
    await getLangSmithClient().createRun({
      id: rootRunId,
      name: 'collabboard_ai_command',
      run_type: 'chain',
      project_name: getProjectName(),
      inputs: {
        boardId: input.boardId,
        userId: input.userId,
        prompt,
        viewportCenter: safeStringify(input.viewportCenter),
      },
      extra: {
        metadata: {
          component: 'boardAgent',
          source: 'collabboard-server',
        },
      },
      start_time: Date.now(),
    });
  });

  return {
    enabled: true,
    rootRunId,
    tracer: getLangChainTracer(),
  };
}

export async function getTraceCallbacks(traceCtx: TraceContext): Promise<BaseCallbackHandler[] | undefined> {
  if (!traceCtx.enabled || !traceCtx.tracer) return undefined;
  return [traceCtx.tracer];
}

export async function recordLLMGeneration(_traceCtx: TraceContext, payload: unknown): Promise<unknown> {
  return payload;
}

export async function recordToolCall(_traceCtx: TraceContext, _payload: unknown): Promise<void> {
  // Tool calls are captured by LangChain callbacks when callbacks are enabled.
}

export async function recordAIError(traceCtx: TraceContext, payload: { message: string; stack?: string; input: unknown; metadata: unknown }): Promise<void> {
  if (!traceCtx.enabled || !traceCtx.rootRunId) return;
  await safeTraceCall(async () => {
    await getLangSmithClient().updateRun(traceCtx.rootRunId!, {
      error: payload.message,
      extra: {
        metadata: {
          errorStack: payload.stack || null,
          input: safeStringify(payload.input),
          context: safeStringify(payload.metadata),
        },
      },
      end_time: Date.now(),
    });
  });
}

export async function finishAITrace(traceCtx: TraceContext, payload: {
  createdIds: string[];
  updatedIds: string[];
  deletedIds: string[];
  toolCalls: unknown[];
  errors: string[];
  durationMs: number;
  completed: boolean;
  modelsUsed?: string[];
}): Promise<void> {
  if (!traceCtx.enabled || !traceCtx.rootRunId) return;

  await safeTraceCall(async () => {
    await getLangSmithClient().updateRun(traceCtx.rootRunId!, {
      outputs: {
        createdIds: payload.createdIds,
        updatedIds: payload.updatedIds,
        deletedIds: payload.deletedIds,
        completed: payload.completed,
        errors: payload.errors,
        durationMs: payload.durationMs,
        modelsUsed: payload.modelsUsed || [],
        toolCallCount: payload.toolCalls.length,
      },
      end_time: Date.now(),
      extra: {
        metadata: {
          aiExecution: {
            completed: payload.completed,
            durationMs: payload.durationMs,
            errorCount: payload.errors.length,
          },
        },
      },
    });
    await getLangSmithClient().flush();
  });
}
