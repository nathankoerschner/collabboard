interface TraceContext {
  enabled: boolean;
  langfuse?: unknown;
  trace?: unknown;
  rootSpan?: unknown;
  redacted?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LangfuseClient = any;

let langfuseClientPromise: Promise<LangfuseClient | null> | null = null;

async function getLangfuseClient(): Promise<LangfuseClient | null> {
  if (langfuseClientPromise) return langfuseClientPromise;

  langfuseClientPromise = (async () => {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    if (!publicKey || !secretKey) return null;

    try {
      const { Langfuse } = await import('langfuse');
      return new Langfuse({
        publicKey,
        secretKey,
        baseUrl: process.env.LANGFUSE_BASE_URL,
      });
    } catch (err) {
      console.warn('Langfuse unavailable:', (err as Error).message);
      return null;
    }
  })();

  return langfuseClientPromise;
}

export async function startAITrace({ boardId, userId, prompt, viewportCenter }: {
  boardId: string;
  userId: string;
  prompt: string;
  viewportCenter: { x: number; y: number };
}): Promise<TraceContext> {
  const langfuse = await getLangfuseClient();
  if (!langfuse) return { enabled: false };
  const redacted = process.env.LANGFUSE_REDACT_PROMPT === 'true';

  const trace = langfuse.trace({
    name: 'board_ai_command',
    userId: userId || 'anonymous',
    sessionId: boardId,
    input: redacted ? { redacted: true } : { prompt, viewportCenter },
    metadata: { boardId, component: 'board-ai-agent' },
  });

  const rootSpan = trace.span({
    name: 'ai_command_execution',
    input: redacted ? { redacted: true } : { prompt, viewportCenter },
    metadata: {
      boardId,
      viewportCenter,
    },
  });

  return { enabled: true, langfuse, trace, rootSpan, redacted };
}

export async function recordLLMGeneration(traceCtx: TraceContext, payload: {
  model: string;
  input: unknown;
  output: unknown;
  usage: unknown;
  metadata: Record<string, unknown>;
  error?: string;
}): Promise<unknown> {
  if (!traceCtx?.enabled) return null;
  const trace = traceCtx.trace as LangfuseClient;
  return trace.generation({
    name: 'openai_tool_calling',
    model: payload.model,
    input: traceCtx.redacted ? { redacted: true } : payload.input,
    output: traceCtx.redacted ? { redacted: true } : payload.output,
    usageDetails: payload.usage,
    metadata: payload.metadata,
    level: payload.error ? 'ERROR' : 'DEFAULT',
    statusMessage: payload.error ? String(payload.error) : undefined,
  });
}

export async function recordToolCall(traceCtx: TraceContext, payload: {
  toolName: string;
  toolCallId: string;
  round: number;
  args: unknown;
  result: unknown;
  error?: string;
  durationMs: number;
}): Promise<void> {
  if (!traceCtx?.enabled) return;
  const trace = traceCtx.trace as LangfuseClient;
  const span = trace.span({
    name: `tool:${payload.toolName}`,
    input: traceCtx.redacted ? { redacted: true } : payload.args,
    metadata: {
      toolCallId: payload.toolCallId,
      round: payload.round,
    },
  });

  span.end({
    output: traceCtx.redacted ? { redacted: true } : payload.result,
    level: payload.error ? 'ERROR' : 'DEFAULT',
    statusMessage: payload.error || undefined,
    metadata: {
      durationMs: payload.durationMs,
    },
  });
}

export async function recordAIError(traceCtx: TraceContext, payload: {
  message: string;
  stack?: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!traceCtx?.enabled) return;
  const trace = traceCtx.trace as LangfuseClient;
  trace.event({
    name: 'ai_command_error',
    input: traceCtx.redacted ? { redacted: true } : payload.input,
    output: {
      message: payload.message,
      stack: payload.stack,
    },
    level: 'ERROR',
    statusMessage: payload.message,
    metadata: payload.metadata,
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
}): Promise<void> {
  if (!traceCtx?.enabled) return;
  const rootSpan = traceCtx.rootSpan as LangfuseClient;
  const trace = traceCtx.trace as LangfuseClient;
  const langfuse = traceCtx.langfuse as LangfuseClient;

  rootSpan?.end({
    output: {
      createdIds: payload.createdIds,
      updatedIds: payload.updatedIds,
      deletedIds: payload.deletedIds,
      errorCount: payload.errors?.length || 0,
    },
    level: payload.errors?.length ? 'ERROR' : 'DEFAULT',
    statusMessage: payload.errors?.length ? payload.errors[0] : undefined,
    metadata: {
      durationMs: payload.durationMs,
      completed: payload.completed,
    },
  });

  trace.update({
    output: {
      createdIds: payload.createdIds,
      updatedIds: payload.updatedIds,
      deletedIds: payload.deletedIds,
      toolCalls: payload.toolCalls,
      errors: payload.errors,
    },
    metadata: {
      durationMs: payload.durationMs,
      completed: payload.completed,
    },
  });

  try {
    await langfuse.flushAsync();
  } catch (err) {
    console.warn('Langfuse flush failed:', (err as Error)?.message || err);
  }
}
