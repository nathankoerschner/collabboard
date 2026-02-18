interface TraceContext {
  enabled: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trace?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rootSpan?: any;
  redacted?: boolean;
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
    await trace.postRun();

    const rootSpan = await trace.createChild({
      name: 'ai_command_execution',
      run_type: 'chain',
      inputs: redacted ? { redacted: true } : { prompt, viewportCenter },
      extra: {
        metadata: { boardId, viewportCenter },
      },
    });
    await rootSpan.postRun();

    return { enabled: true, trace, rootSpan, redacted };
  } catch (err: unknown) {
    console.warn('LangSmith trace start failed:', (err as Error)?.message || err);
    return { enabled: false };
  }
}

export async function recordLLMGeneration(traceCtx: TraceContext, payload: { model: string; input: unknown; output: unknown; usage: unknown; metadata: unknown; error?: unknown }): Promise<unknown> {
  if (!traceCtx?.enabled) return null;
  try {
    const run = await traceCtx.trace.createChild({
      name: 'openai_tool_calling',
      run_type: 'llm',
      inputs: traceCtx.redacted ? { redacted: true } : payload.input,
      extra: {
        metadata: {
          model: payload.model,
          ...(payload.metadata as Record<string, unknown>),
        },
      },
    });
    await run.postRun();
    await run.end({
      outputs: traceCtx.redacted ? { redacted: true } : { response: payload.output, usage: payload.usage },
      error: payload.error ? String(payload.error) : undefined,
    });
    await run.patchRun();
    return run;
  } catch (err: unknown) {
    console.warn('LangSmith LLM run failed:', (err as Error)?.message || err);
    return null;
  }
}

export async function recordToolCall(traceCtx: TraceContext, payload: { toolName: string; toolCallId: string; round: number; args: unknown; result: unknown; error?: string; durationMs: number }): Promise<void> {
  if (!traceCtx?.enabled) return;
  try {
    const run = await traceCtx.trace.createChild({
      name: `tool:${payload.toolName}`,
      run_type: 'tool',
      inputs: traceCtx.redacted ? { redacted: true } : payload.args,
      extra: {
        metadata: {
          toolCallId: payload.toolCallId,
          round: payload.round,
          durationMs: payload.durationMs,
        },
      },
    });
    await run.postRun();
    await run.end({
      outputs: traceCtx.redacted ? { redacted: true } : { result: payload.result },
      error: payload.error || undefined,
    });
    await run.patchRun();
  } catch (err: unknown) {
    console.warn('LangSmith tool run failed:', (err as Error)?.message || err);
  }
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

export async function finishAITrace(traceCtx: TraceContext, payload: { createdIds: string[]; updatedIds: string[]; deletedIds: string[]; toolCalls: unknown[]; errors: string[]; durationMs: number; completed: boolean }): Promise<void> {
  if (!traceCtx?.enabled) return;
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
