export interface TraceContext {
  enabled: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trace?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rootSpan?: any;
  redacted?: boolean;
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
    if (!apiKey || process.env.LANGSMITH_TRACING === 'false') return null;

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

    const rootSpan = trace.createChild({
      name: 'ai_command_execution',
      run_type: 'chain',
      inputs: redacted ? { redacted: true } : { prompt, viewportCenter },
      extra: {
        metadata: { boardId, viewportCenter },
      },
    });
    background(rootSpan.postRun(), 'LangSmith root span post failed');

    return { enabled: true, trace, rootSpan, redacted };
  } catch (err: unknown) {
    console.warn('LangSmith trace start failed:', (err as Error)?.message || err);
    return { enabled: false };
  }
}

export async function startRoundSpan(traceCtx: TraceContext, { round, model }: { round: number; model: string }): Promise<unknown> {
  if (!traceCtx?.enabled || !traceCtx.rootSpan) return null;
  try {
    const span = traceCtx.rootSpan.createChild({
      name: `llm_round_${round}`,
      run_type: 'llm',
      extra: {
        metadata: { model, round },
      },
    });
    background(span.postRun(), `LangSmith round ${round} span post failed`);
    return span;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function endRoundSpan(span: any, { model, toolCalls }: { model: string; toolCalls: string[] }): Promise<void> {
  if (!span) return;
  try {
    await span.end({
      outputs: { model, toolCalls },
    });
    await span.patchRun();
  } catch {
    // swallow
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
    if (traceCtx.rootSpan) {
      await traceCtx.rootSpan.end({
        outputs: {
          createdIds: payload.createdIds,
          updatedIds: payload.updatedIds,
          deletedIds: payload.deletedIds,
          errorCount: payload.errors?.length || 0,
        },
        error: payload.errors?.length ? payload.errors[0] : undefined,
      });
      await traceCtx.rootSpan.patchRun();
    }

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
