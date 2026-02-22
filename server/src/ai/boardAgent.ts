import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { AIMessage } from '@langchain/core/messages';
// @ts-expect-error y-websocket/bin/utils has no types
import { getYDoc } from 'y-websocket/bin/utils';
import { BoardToolRunner } from './boardTools.js';
import { normalizeViewportCenter, toLangChainTools } from './schema.js';
import { finishAITrace, recordAIError, startAITrace, getTraceCallbacks } from './observability.js';
import { extractGitHubUrl, fetchRepoMetadata, fetchRepoTree } from './github.js';
import { buildRepoSystemPrompt, runGitHubExplorationPipeline, type GitHubAnalysisMetrics } from './codeAnalyzer.js';

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
    'When you need to display text, always use sticky notes (createStickyNote) instead of standalone text objects. Stickies are the primary text vehicle on the board.',
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

interface DiagramPhaseResult {
  completed: boolean;
  modelsUsed: Set<string>;
}

interface GitHubPhaseResult {
  ok: boolean;
  systemPrompt: string;
  effectivePrompt: string;
  metrics: GitHubAnalysisMetrics;
  error?: string;
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

async function runGitHubAnalysisPhase(prompt: string): Promise<GitHubPhaseResult | null> {
  const ghMatch = extractGitHubUrl(prompt);
  if (!ghMatch) return null;

  try {
    const { parsed, promptWithoutUrl } = ghMatch;
    const metadata = await fetchRepoMetadata(parsed.owner, parsed.repo);
    const { tree, branch } = await fetchRepoTree(parsed.owner, parsed.repo, parsed.branch, parsed.path);
    const repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;

    const analysis = await runGitHubExplorationPipeline({
      promptWithoutUrl,
      repoUrl,
      owner: parsed.owner,
      repo: parsed.repo,
      branch,
      scopedPath: parsed.path,
      metadata,
      tree,
    });

    if (!analysis.ok) {
      return {
        ok: false,
        systemPrompt: buildSystemPrompt(),
        effectivePrompt: promptWithoutUrl || prompt,
        metrics: analysis.metrics,
        error: analysis.userMessage,
      };
    }

    const fallbackPromptByType: Record<string, string> = {
      architecture: 'Generate an architecture diagram for this repository.',
      erd: 'Generate an ERD diagram for this repository.',
      component: 'Generate a component diagram for this repository.',
      dependency: 'Generate a dependency diagram for this repository.',
    };

    return {
      ok: true,
      systemPrompt: buildRepoSystemPrompt(analysis.context),
      effectivePrompt: analysis.promptWithoutUrl || fallbackPromptByType[analysis.context.diagramType] || prompt,
      metrics: analysis.metrics,
    };
  } catch (err: unknown) {
    const errMsg = (err as Error)?.message || 'Failed to fetch repository';
    return {
      ok: false,
      systemPrompt: buildSystemPrompt(),
      effectivePrompt: prompt,
      metrics: {
        urlDetected: true,
        diagramType: undefined,
        repoToolsExposed: true,
        roundsUsed: 0,
        filesTouched: 0,
        bytesFetched: 0,
        finalRepoContextTokens: 0,
        fallbackPathTaken: 'none',
        phaseLatenciesMs: {
          metadataTree: 0,
          planning: 0,
          retrieval: 0,
        },
      },
      error: `GitHub retrieval failed: ${errMsg}`,
    };
  }
}

async function runDiagramExecutionPhase(input: {
  systemPrompt: string;
  effectivePrompt: string;
  viewport: ViewportContext;
  selectedObjectIds?: string[];
  boardId: string;
  userId: string;
  traceCallbacks: unknown;
  startWithPowerModel?: boolean;
}): Promise<{ mutationSummary: {
  createdIds: string[];
  updatedIds: string[];
  deletedIds: string[];
  toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>;
}; result: DiagramPhaseResult }> {
  const yDoc = getYDoc(input.boardId);
  if (yDoc.whenInitialized) {
    await yDoc.whenInitialized;
  }

  const toolRunner = BoardToolRunner.fromYDoc(yDoc, {
    viewportCenter: input.viewport.center,
    actorId: `ai:${input.userId || 'anonymous'}`,
  });

  const tools = toLangChainTools(toolRunner);

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

  const messages: BaseMessage[] = [
    new SystemMessage(input.systemPrompt),
    new HumanMessage(JSON.stringify({
      prompt: input.effectivePrompt,
      viewportCenter: input.viewport,
      selectedObjectIds: input.selectedObjectIds || [],
    })),
  ];

  const modelsUsed = new Set<string>();
  const layoutTools = new Set(['createFrame', 'arrangeObjectsInGrid']);
  let needsPowerModel = Boolean(input.startWithPowerModel);
  let completed = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const model = needsPowerModel ? POWER_MODEL : FAST_MODEL;
    const llm = needsPowerModel ? powerLlm : fastLlm;
    modelsUsed.add(model);

    const response = await llm.bindTools(tools).invoke(messages, {
      metadata: { model, round },
      tags: [`model:${model}`, `round:${round}`],
      runName: `round_${round}_${model}`,
      callbacks: input.traceCallbacks as any,
    }) as AIMessage;
    messages.push(response);

    const toolCalls = response.tool_calls ?? [];
    if (toolCalls.length === 0) {
      completed = true;
      break;
    }

    if (!needsPowerModel && toolCalls.some((tc) => layoutTools.has(tc.name))) {
      needsPowerModel = true;
    }

    for (const toolCall of toolCalls) {
      const tool = tools.find((t) => t.name === toolCall.name);
      const result = tool
        ? await tool.invoke(toolCall.args, {
          metadata: { model, round, toolName: toolCall.name, toolCallId: toolCall.id },
          tags: [`model:${model}`, `round:${round}`, `tool:${toolCall.name}`],
          runName: `tool_${toolCall.name}`,
          callbacks: input.traceCallbacks as any,
        })
        : JSON.stringify({ error: `Unknown tool: ${toolCall.name}` });
      messages.push(new ToolMessage({
        content: typeof result === 'string' ? result : JSON.stringify(result),
        tool_call_id: toolCall.id!,
        name: toolCall.name,
      }));
    }
  }

  return {
    mutationSummary: toolRunner.applyToDoc(),
    result: {
      completed,
      modelsUsed,
    },
  };
}

export async function executeBoardAICommand({ boardId, prompt, viewportCenter, selectedObjectIds, userId }: AICommandInput): Promise<AICommandResult> {
  const startedAt = Date.now();
  const viewport = normalizeViewportContext(viewportCenter);
  const traceCtx = await startAITrace({ boardId, userId, prompt, viewportCenter: viewport });

  const errors: string[] = [];
  let completed = false;
  const modelsUsed = new Set<string>();
  let githubAnalysis: GitHubAnalysisMetrics | undefined;
  let mutationSummary = {
    createdIds: [] as string[],
    updatedIds: [] as string[],
    deletedIds: [] as string[],
    toolCalls: [] as Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>,
  };

  try {
    const collapseRuns = process.env.LANGSMITH_COLLAPSE_RUNS === 'true';
    const traceCallbacks = collapseRuns ? undefined : await getTraceCallbacks(traceCtx);

    let systemPrompt = buildSystemPrompt();
    let effectivePrompt = prompt;

    const githubPhase = await runGitHubAnalysisPhase(prompt);
    if (githubPhase) {
      githubAnalysis = githubPhase.metrics;
      if (!githubPhase.ok) {
        errors.push(githubPhase.error || 'GitHub analysis failed');
        return {
          createdIds: [],
          updatedIds: [],
          deletedIds: [],
          durationMs: Date.now() - startedAt,
          completed: false,
          errors,
        };
      }
      systemPrompt = githubPhase.systemPrompt;
      effectivePrompt = githubPhase.effectivePrompt;
    } else {
      githubAnalysis = {
        urlDetected: false,
        diagramType: undefined,
        repoToolsExposed: false,
        roundsUsed: 0,
        filesTouched: 0,
        bytesFetched: 0,
        finalRepoContextTokens: 0,
        fallbackPathTaken: 'none',
        phaseLatenciesMs: {
          metadataTree: 0,
          planning: 0,
          retrieval: 0,
        },
      };
    }

    const diagramPhase = await runDiagramExecutionPhase({
      systemPrompt,
      effectivePrompt,
      viewport,
      selectedObjectIds,
      boardId,
      userId,
      traceCallbacks,
      startWithPowerModel: Boolean(githubPhase),
    });

    mutationSummary = diagramPhase.mutationSummary;
    completed = diagramPhase.result.completed;
    for (const model of diagramPhase.result.modelsUsed) {
      modelsUsed.add(model);
    }
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
      githubAnalysis,
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
