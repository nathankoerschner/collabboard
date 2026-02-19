export interface TraceContext {
  enabled: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trace?: any;
  redacted?: boolean;
  callbacks?: unknown[];
}

function background(task: Promise<unknown>, label: string): void {
  void task.catch((err: unknown) => {
    console.warn(`${label}:`, (err as Error)?.message || err);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runTreeCtorPromise: Promise<any> | null = null;

async function getRunTreeCtor() {
  if (runTreeCtorPromise) return runTreeCtorPromise;

  runTreeCtorPromise = (async () => {
    const apiKey = process.env.LANGSMITH_API_KEY;
    if (!apiKey) return null;

    try {
      const { RunTree } = await import('langsmith');
      return RunTree;
    } catch (err: unknown) {
      console.warn('LangSmith unavailable:', (err as Error).message);
      return null;
    }
  })();

  return runTreeCtorPromise;
}

export async function startAITrace({ boardId, userId, prompt, viewportCenter }: { boardId: string; userId: string; prompt: string; viewportCenter: unknown }): Promise<TraceContext> {
  const RunTree = await getRunTreeCtor();
  if (!RunTree) return { enabled: false };
  const redacted = process.env.LANGSMITH_REDACT_PROMPT === 'true';

  try {
    const trace = new RunTree({
      name: 'board_ai_command',
      run_type: 'chain',
      inputs: redacted ? { redacted: true } : { prompt, viewportCenter },
      project_name: process.env.LANGSMITH_PROJECT,
      apiUrl: process.env.LANGSMITH_ENDPOINT,
      apiKey: process.env.LANGSMITH_API_KEY,
      extra: {
        metadata: { boardId, userId: userId || 'anonymous', component: 'board-ai-agent' },
      },
    });
    background(trace.postRun(), 'LangSmith trace post failed');
    return { enabled: true, trace, redacted };
  } catch (err: unknown) {
    console.warn('LangSmith trace start failed:', (err as Error)?.message || err);
    return { enabled: false };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getLangchainCallbacksFn: ((runTree: any) => Promise<any>) | null = null;

async function loadGetLangchainCallbacks() {
  if (getLangchainCallbacksFn !== undefined && getLangchainCallbacksFn !== null) return getLangchainCallbacksFn;
  try {
    const mod = await import('langsmith/langchain');
    getLangchainCallbacksFn = mod.getLangchainCallbacks;
    return getLangchainCallbacksFn;
  } catch {
    getLangchainCallbacksFn = null;
    return null;
  }
}

export async function getTraceCallbacks(traceCtx: TraceContext): Promise<unknown[] | undefined> {
  if (!traceCtx?.enabled || !traceCtx.trace) return undefined;
  if (traceCtx.callbacks) return traceCtx.callbacks;
  try {
    const fn = await loadGetLangchainCallbacks();
    if (!fn) return undefined;
    const callbacks = await fn(traceCtx.trace);
    traceCtx.callbacks = callbacks ? [callbacks] : undefined;
    return traceCtx.callbacks;
  } catch {
    return undefined;
  }
}

let traceSuppressionDepth = 0;
let previousLangsmithTracing: string | undefined;

export async function withCollapsedLangChainTracing<T>(fn: () => Promise<T>): Promise<T> {
  if (process.env.LANGSMITH_COLLAPSE_RUNS === 'false') {
    return fn();
  }

  if (traceSuppressionDepth === 0) {
    previousLangsmithTracing = process.env.LANGSMITH_TRACING;
    process.env.LANGSMITH_TRACING = 'false';
  }
  traceSuppressionDepth += 1;

  try {
    return await fn();
  } finally {
    traceSuppressionDepth -= 1;
    if (traceSuppressionDepth === 0) {
      if (previousLangsmithTracing === undefined) {
        delete process.env.LANGSMITH_TRACING;
      } else {
        process.env.LANGSMITH_TRACING = previousLangsmithTracing;
      }
      previousLangsmithTracing = undefined;
    }
  }
}

// LangChain auto-traces LLM generations and tool calls to LangSmith when
// LANGSMITH_API_KEY is set. These no-op stubs preserve the export signature
// for any callers that still reference them (e.g. tests).
export async function recordLLMGeneration(_traceCtx: TraceContext, _payload: unknown): Promise<unknown> {
  return null;
}

export async function recordToolCall(_traceCtx: TraceContext, _payload: unknown): Promise<void> {
  // no-op — LangChain traces tool calls automatically
}

export async function recordAIError(traceCtx: TraceContext, payload: { message: string; stack?: string; input: unknown; metadata: unknown }): Promise<void> {
  if (!traceCtx?.enabled) return;
  try {
    const run = await traceCtx.trace.createChild({
      name: 'ai_command_error',
      run_type: 'tool',
      inputs: traceCtx.redacted ? { redacted: true } : payload.input,
      extra: {
        metadata: payload.metadata,
      },
    });
    await run.postRun();
    await run.end({
      outputs: {
        message: payload.message,
        stack: payload.stack,
      },
      error: payload.message,
    });
    await run.patchRun();
  } catch (err: unknown) {
    console.warn('LangSmith error event failed:', (err as Error)?.message || err);
  }
}

export async function finishAITrace(traceCtx: TraceContext, payload: { createdIds: string[]; updatedIds: string[]; deletedIds: string[]; toolCalls: unknown[]; errors: string[]; durationMs: number; completed: boolean; modelsUsed?: string[] }): Promise<void> {
  if (!traceCtx?.enabled) return;
  const escalated = (payload.modelsUsed?.length ?? 0) > 1;
  const modelTags = (payload.modelsUsed ?? []).map((m) => `model:${m}`);
  if (escalated) modelTags.push('escalated');

  try {
    // Patch metadata and tags onto the trace for first-class LangSmith filtering
    traceCtx.trace.extra = {
      ...traceCtx.trace.extra,
      metadata: {
        ...(traceCtx.trace.extra?.metadata || {}),
        modelsUsed: payload.modelsUsed,
        escalated,
      },
    };
    traceCtx.trace.tags = [...(traceCtx.trace.tags || []), ...modelTags];

    await traceCtx.trace.end({
      outputs: {
        createdIds: payload.createdIds,
        updatedIds: payload.updatedIds,
        deletedIds: payload.deletedIds,
        toolCalls: payload.toolCalls,
        errors: payload.errors,
        durationMs: payload.durationMs,
        completed: payload.completed,
      },
      error: payload.errors?.length ? payload.errors[0] : undefined,
    });
    await traceCtx.trace.patchRun();
  } catch (err: unknown) {
    console.warn('LangSmith trace finish failed:', (err as Error)?.message || err);
  }
}
