export interface TraceContext {
  enabled: boolean;
}

export async function startAITrace(_input: { boardId: string; userId: string; prompt: string; viewportCenter: unknown }): Promise<TraceContext> {
  return { enabled: false };
}

export async function getTraceCallbacks(_traceCtx: TraceContext): Promise<unknown | undefined> {
  return undefined;
}

export async function recordLLMGeneration(_traceCtx: TraceContext, _payload: unknown): Promise<unknown> {
  return null;
}

export async function recordToolCall(_traceCtx: TraceContext, _payload: unknown): Promise<void> {
  // no-op
}

export async function recordAIError(_traceCtx: TraceContext, _payload: { message: string; stack?: string; input: unknown; metadata: unknown }): Promise<void> {
  // no-op
}

export async function finishAITrace(_traceCtx: TraceContext, _payload: {
  createdIds: string[];
  updatedIds: string[];
  deletedIds: string[];
  toolCalls: unknown[];
  errors: string[];
  durationMs: number;
  completed: boolean;
  modelsUsed?: string[];
}): Promise<void> {
  // no-op
}
