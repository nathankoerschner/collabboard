import type { FileTreeNode, RepoMetadata } from './github.js';
import {
  buildDirectoryTree,
  fetchFileChunk,
  fetchFileContents,
  fetchFileHead,
  searchInFile,
  searchRepoPaths,
} from './github.js';

export type DiagramType = 'architecture' | 'erd' | 'component' | 'dependency';

export interface RepoBootstrapContext {
  repoUrl: string;
  owner: string;
  repo: string;
  branch: string;
  scopedPath?: string;
  description: string;
  language: string;
  shallowTree: string;
  fileCountsByExt: Record<string, number>;
}

export type ExplorationOperation =
  | { kind: 'head'; path: string; maxLines: number }
  | { kind: 'chunk'; path: string; startLine: number; endLine: number }
  | { kind: 'search'; query: string; scope?: string };

export interface RepoExplorationPlan {
  diagramType: DiagramType;
  questions: string[];
  candidates: Array<{ path: string; reason: string; priority: number }>;
  operations: ExplorationOperation[];
  maxRounds: number;
  maxFiles: number;
  maxTokens: number;
  maxBytes: number;
}

export interface ScannedContent {
  path: string;
  snippet: string;
  reason: string;
  source: 'head' | 'chunk' | 'search';
}

export interface RepoContextForDiagram {
  repoUrl: string;
  diagramType: DiagramType;
  summary: string;
  keyFindings: string[];
  scannedContents: ScannedContent[];
  confidence: 'high' | 'medium' | 'low';
  knownGaps: string[];
}

export interface LegacyRepoContext {
  repoUrl: string;
  description: string;
  language: string;
  directoryTree: string;
  files: { path: string; content: string }[];
  diagramType: DiagramType;
}

export interface GitHubAnalysisMetrics {
  urlDetected: boolean;
  diagramType?: DiagramType;
  repoToolsExposed: boolean;
  roundsUsed: number;
  filesTouched: number;
  bytesFetched: number;
  finalRepoContextTokens: number;
  fallbackPathTaken: 'none' | 'planner' | 'heuristic';
  phaseLatenciesMs: {
    metadataTree: number;
    planning: number;
    retrieval: number;
  };
}

export interface GitHubAnalysisSuccess {
  ok: true;
  context: RepoContextForDiagram;
  promptWithoutUrl: string;
  metrics: GitHubAnalysisMetrics;
}

export interface GitHubAnalysisFailure {
  ok: false;
  userMessage: string;
  metrics: GitHubAnalysisMetrics;
}

export type GitHubAnalysisResult = GitHubAnalysisSuccess | GitHubAnalysisFailure;

interface PipelineInput {
  promptWithoutUrl: string;
  repoUrl: string;
  owner: string;
  repo: string;
  branch: string;
  scopedPath?: string;
  metadata: RepoMetadata;
  tree: FileTreeNode[];
}

interface RetrievalState {
  round: number;
  scannedContents: ScannedContent[];
  touchedFiles: Set<string>;
  bytesFetched: number;
  knownGaps: string[];
  pendingOperations: ExplorationOperation[];
}

const DEFAULT_MAX_ROUNDS = Number(process.env.GITHUB_ANALYSIS_MAX_ROUNDS) || 5;
const DEFAULT_MAX_FILES = Number(process.env.GITHUB_ANALYSIS_MAX_FILES) || 25;
const DEFAULT_MAX_BYTES = Number(process.env.GITHUB_ANALYSIS_MAX_BYTES) || 520 * 1024;
const DEFAULT_MAX_CONTEXT_TOKENS = Number(process.env.GITHUB_ANALYSIS_MAX_CONTEXT_TOKENS) || 14_000;

const FALLBACK_MAX_FILES = 10;
const MAX_SCANNED_ITEMS = 40;

/** Rough token estimate: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function asUniquePaths(tree: FileTreeNode[]): Set<string> {
  return new Set(tree.filter((node) => node.type === 'blob').map((node) => node.path));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function summarizeTreeStats(tree: FileTreeNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of tree) {
    if (node.type !== 'blob') continue;
    const extMatch = node.path.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1]!.toLowerCase() : 'no_ext';
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return counts;
}

function confidenceFromScannedContents(evidenceCount: number, gaps: number): 'high' | 'medium' | 'low' {
  if (evidenceCount >= 10 && gaps === 0) return 'high';
  if (evidenceCount >= 5) return 'medium';
  return 'low';
}

function diagramTypeKeywords(prompt: string): DiagramType | null {
  const p = prompt.toLowerCase();
  if (/\b(erd|entity\s*relationship|database schema|data model|tables?)\b/.test(p)) return 'erd';
  if (/\b(component|ui component|frontend structure|widget tree)\b/.test(p)) return 'component';
  if (/\b(dependency|dependencies|import graph|package graph)\b/.test(p)) return 'dependency';
  if (/\b(architecture|system design|service map|overview|high level)\b/.test(p)) return 'architecture';
  return null;
}

export function inferDiagramType(prompt: string, bootstrap: RepoBootstrapContext): DiagramType {
  const fromPrompt = diagramTypeKeywords(prompt);
  if (fromPrompt) return fromPrompt;

  const stats = bootstrap.fileCountsByExt;
  if ((stats.sql || 0) + (stats.prisma || 0) > 2) return 'erd';
  if ((stats.tsx || 0) + (stats.jsx || 0) + (stats.vue || 0) > 6) return 'component';
  return 'architecture';
}

function topInterestingPaths(tree: FileTreeNode[], diagramType: DiagramType, limit = 18): Array<{ path: string; reason: string; priority: number }> {
  const blobs = tree.filter((node) => node.type === 'blob');
  const scored = blobs.map((node) => {
    const path = node.path;
    let score = 0;
    let reason = 'General relevance';

    if (/^README\.md$/i.test(path)) {
      score += 8;
      reason = 'Repository overview';
    }
    if (/^package\.json$/i.test(path) || /Cargo\.toml$/i.test(path) || /pyproject\.toml$/i.test(path) || /go\.mod$/i.test(path)) {
      score += 7;
      reason = 'Dependency and package structure';
    }
    if (/schema|model|entity|migration|prisma|sql/i.test(path)) {
      score += diagramType === 'erd' ? 10 : 4;
      reason = diagramType === 'erd' ? 'Likely data model source' : reason;
    }
    if (/components?|views?|pages?|ui/i.test(path)) {
      score += diagramType === 'component' ? 9 : 2;
      if (diagramType === 'component') reason = 'Likely UI component definition';
    }
    if (/src\/(index|main|app)|server|routes|controllers?|services?/i.test(path)) {
      score += diagramType === 'architecture' ? 9 : 3;
      if (diagramType === 'architecture') reason = 'Likely architecture entry point/module';
    }
    const depth = path.split('/').length;
    score += Math.max(0, 5 - depth);

    return { path, reason, priority: score };
  });

  return scored
    .filter((entry) => entry.priority > 3)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}

function buildDefaultQuestions(diagramType: DiagramType): string[] {
  if (diagramType === 'erd') {
    return [
      'Which entities/tables are defined?',
      'How are entities related?',
      'Where are migrations or schema constraints?',
    ];
  }
  if (diagramType === 'component') {
    return [
      'What are the major components/views?',
      'How do components compose each other?',
      'Where are boundaries between UI layers?',
    ];
  }
  if (diagramType === 'dependency') {
    return [
      'What are the primary package dependencies?',
      'Which modules have the most imports/edges?',
      'What runtime layers are implied by dependencies?',
    ];
  }
  return [
    'What are the system entry points?',
    'How are modules/services layered?',
    'Where does data flow between modules?',
  ];
}

function buildInitialOperations(
  diagramType: DiagramType,
  candidates: Array<{ path: string; reason: string; priority: number }>,
  scopedPath?: string,
): ExplorationOperation[] {
  const ops: ExplorationOperation[] = [];
  const top = candidates.slice(0, 8);

  for (const candidate of top) {
    ops.push({ kind: 'head', path: candidate.path, maxLines: diagramType === 'erd' ? 220 : 160 });
  }

  const searchTerms = diagramType === 'erd'
    ? ['schema', 'model', 'foreign key', 'relation']
    : diagramType === 'component'
      ? ['component', 'props', 'render', 'route']
      : diagramType === 'dependency'
        ? ['dependencies', 'imports', 'requires', 'package']
        : ['service', 'controller', 'route', 'module'];

  for (const query of searchTerms) {
    ops.push({ kind: 'search', query, scope: scopedPath });
  }

  return ops;
}

function validateRepoExplorationPlan(raw: RepoExplorationPlan): RepoExplorationPlan | null {
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) return null;
  if (!Array.isArray(raw.candidates) || raw.candidates.length === 0) return null;
  if (!Array.isArray(raw.operations) || raw.operations.length === 0) return null;

  const maxRounds = Math.max(1, Math.min(6, Number(raw.maxRounds) || DEFAULT_MAX_ROUNDS));
  const maxFiles = Math.max(4, Math.min(40, Number(raw.maxFiles) || DEFAULT_MAX_FILES));
  const maxTokens = Math.max(2000, Math.min(20_000, Number(raw.maxTokens) || DEFAULT_MAX_CONTEXT_TOKENS));
  const maxBytes = Math.max(40_000, Math.min(1024 * 1024, Number(raw.maxBytes) || DEFAULT_MAX_BYTES));

  return {
    ...raw,
    maxRounds,
    maxFiles,
    maxTokens,
    maxBytes,
    operations: raw.operations.slice(0, 80),
    candidates: raw.candidates
      .filter((c) => c.path && Number.isFinite(c.priority))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 30),
  };
}

export function planRepoExploration(input: {
  promptWithoutUrl: string;
  bootstrap: RepoBootstrapContext;
  tree: FileTreeNode[];
}): RepoExplorationPlan {
  const diagramType = inferDiagramType(input.promptWithoutUrl, input.bootstrap);
  const candidates = topInterestingPaths(input.tree, diagramType);
  const questions = buildDefaultQuestions(diagramType);

  const rawPlan: RepoExplorationPlan = {
    diagramType,
    questions,
    candidates,
    operations: buildInitialOperations(diagramType, candidates, input.bootstrap.scopedPath),
    maxRounds: DEFAULT_MAX_ROUNDS,
    maxFiles: DEFAULT_MAX_FILES,
    maxTokens: DEFAULT_MAX_CONTEXT_TOKENS,
    maxBytes: DEFAULT_MAX_BYTES,
  };

  const validated = validateRepoExplorationPlan(rawPlan);
  if (!validated) {
    throw new Error('Planner produced invalid plan');
  }
  return validated;
}

function buildFallbackPlan(input: {
  promptWithoutUrl: string;
  bootstrap: RepoBootstrapContext;
  tree: FileTreeNode[];
}): RepoExplorationPlan {
  const diagramType = inferDiagramType(input.promptWithoutUrl, input.bootstrap);
  const selected = selectFiles(input.tree, diagramType).slice(0, FALLBACK_MAX_FILES);
  const candidates = selected.map((path, index) => ({
    path,
    reason: 'Heuristic fallback file selection',
    priority: selected.length - index,
  }));

  const plan: RepoExplorationPlan = {
    diagramType,
    questions: buildDefaultQuestions(diagramType),
    candidates,
    operations: candidates.map((candidate) => ({ kind: 'head', path: candidate.path, maxLines: 140 })),
    maxRounds: 2,
    maxFiles: FALLBACK_MAX_FILES,
    maxTokens: 10_000,
    maxBytes: 220 * 1024,
  };

  return validateRepoExplorationPlan(plan) ?? plan;
}

function pathIsAllowed(path: string, allowedPaths: Set<string>): boolean {
  if (!path || path.includes('..') || path.startsWith('/')) return false;
  return allowedPaths.has(path);
}

function bytesOf(text: string): number {
  return Buffer.byteLength(text, 'utf-8');
}

function cappedSnippet(text: string, max = 2200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... (truncated)`;
}

function dedupeScannedContents(items: ScannedContent[]): ScannedContent[] {
  const seen = new Set<string>();
  const out: ScannedContent[] = [];

  for (const item of items) {
    const key = `${item.source}:${item.path}:${item.snippet.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out.slice(0, MAX_SCANNED_ITEMS);
}

function queueRefinementOperations(plan: RepoExplorationPlan, state: RetrievalState): ExplorationOperation[] {
  if (state.scannedContents.length >= 8) return [];

  const uncoveredCandidates = plan.candidates
    .map((candidate) => candidate.path)
    .filter((path) => !state.touchedFiles.has(path));

  const nextReads: ExplorationOperation[] = uncoveredCandidates
    .slice(0, 6)
    .map((path) => ({ kind: 'head', path, maxLines: 120 }));

  if (plan.diagramType === 'erd' && nextReads.length < 3) {
    nextReads.push({ kind: 'search', query: 'foreign key', scope: undefined });
    nextReads.push({ kind: 'search', query: 'relation', scope: undefined });
  }

  return nextReads;
}

function applyHardCaps(plan: RepoExplorationPlan, state: RetrievalState): string | null {
  if (state.touchedFiles.size > plan.maxFiles) {
    return `file budget exceeded (${state.touchedFiles.size}/${plan.maxFiles})`;
  }
  if (state.bytesFetched > plan.maxBytes) {
    return `byte budget exceeded (${state.bytesFetched}/${plan.maxBytes})`;
  }
  return null;
}

export async function executeExplorationRound(
  input: PipelineInput,
  plan: RepoExplorationPlan,
  state: RetrievalState,
): Promise<{ addedContents: ScannedContent[]; nextOperations: ExplorationOperation[]; completed: boolean; hardCapError: string | null }> {
  const allowedPaths = asUniquePaths(input.tree);
  const addedContents: ScannedContent[] = [];
  const remainingOps = [...state.pendingOperations];

  while (remainingOps.length > 0) {
    const operation = remainingOps.shift()!;

    if (operation.kind === 'head') {
      if (!pathIsAllowed(operation.path, allowedPaths)) continue;
      if (!state.touchedFiles.has(operation.path) && state.touchedFiles.size >= plan.maxFiles) {
        return { addedContents, nextOperations: remainingOps, completed: true, hardCapError: applyHardCaps(plan, state) || `file budget exceeded (${state.touchedFiles.size}/${plan.maxFiles})` };
      }

      const snippet = await fetchFileHead(input.owner, input.repo, operation.path, input.branch, operation.maxLines);
      if (!snippet) {
        state.knownGaps.push(`Could not read file head: ${operation.path}`);
        continue;
      }

      const b = bytesOf(snippet);
      state.bytesFetched += b;
      state.touchedFiles.add(operation.path);
      addedContents.push({
        path: operation.path,
        snippet: cappedSnippet(snippet),
        reason: 'Top-of-file context for architectural intent',
        source: 'head',
      });
    }

    if (operation.kind === 'chunk') {
      if (!pathIsAllowed(operation.path, allowedPaths)) continue;
      if (!state.touchedFiles.has(operation.path) && state.touchedFiles.size >= plan.maxFiles) {
        return { addedContents, nextOperations: remainingOps, completed: true, hardCapError: applyHardCaps(plan, state) || `file budget exceeded (${state.touchedFiles.size}/${plan.maxFiles})` };
      }

      const snippet = await fetchFileChunk(
        input.owner,
        input.repo,
        operation.path,
        input.branch,
        operation.startLine,
        operation.endLine,
      );
      if (!snippet) {
        state.knownGaps.push(`Could not read file chunk: ${operation.path}:${operation.startLine}-${operation.endLine}`);
        continue;
      }

      const b = bytesOf(snippet);
      state.bytesFetched += b;
      state.touchedFiles.add(operation.path);
      addedContents.push({
        path: operation.path,
        snippet: cappedSnippet(snippet),
        reason: `Targeted chunk read (${operation.startLine}-${operation.endLine})`,
        source: 'chunk',
      });
    }

    if (operation.kind === 'search') {
      const pathHits = searchRepoPaths(input.tree, operation.query, operation.scope).slice(0, 8);
      if (pathHits.length === 0) {
        state.knownGaps.push(`No path matches for search query: ${operation.query}`);
        continue;
      }

      for (const path of pathHits) {
        addedContents.push({
          path,
          snippet: `Matched path for query "${operation.query}": ${path}`,
          reason: 'Path-level repository search signal',
          source: 'search',
        });

        if (state.touchedFiles.size < plan.maxFiles && !state.touchedFiles.has(path)) {
          const matchLines = await searchInFile(input.owner, input.repo, path, input.branch, operation.query, 3);
          if (matchLines.length > 0) {
            const matchSnippet = matchLines.map((m) => `${m.line}: ${m.text}`).join('\n');
            state.bytesFetched += bytesOf(matchSnippet);
            state.touchedFiles.add(path);
            addedContents.push({
              path,
              snippet: cappedSnippet(matchSnippet),
              reason: `In-file matches for query "${operation.query}"`,
              source: 'search',
            });
          }
        }
      }
    }

    const capError = applyHardCaps(plan, state);
    if (capError) {
      return { addedContents, nextOperations: remainingOps, completed: true, hardCapError: capError };
    }
  }

  const nextOperations = queueRefinementOperations(plan, state);
  const completed = nextOperations.length === 0;
  return { addedContents, nextOperations, completed, hardCapError: null };
}

export function buildRepoContextFromScannedContents(input: {
  repoUrl: string;
  diagramType: DiagramType;
  description: string;
  language: string;
  shallowTree: string;
  scannedContents: ScannedContent[];
  knownGaps: string[];
}): RepoContextForDiagram {
  const scannedContents = dedupeScannedContents(input.scannedContents);
  const keyFindings = scannedContents.slice(0, 10).map((item) => normalizeWhitespace(`${item.path}: ${item.reason}`));

  const summaryParts = [
    `Repository language: ${input.language || 'Unknown'}.`,
    input.description ? `Description: ${input.description}.` : '',
    `Scanned contents from ${new Set(scannedContents.map((item) => item.path)).size} files/paths.`,
  ].filter(Boolean);

  const confidence = confidenceFromScannedContents(scannedContents.length, input.knownGaps.length);

  return {
    repoUrl: input.repoUrl,
    diagramType: input.diagramType,
    summary: normalizeWhitespace(summaryParts.join(' ')),
    keyFindings,
    scannedContents,
    confidence,
    knownGaps: input.knownGaps.slice(0, 12),
  };
}

export const BOARD_POSITIONING_RULES = [
  'You MUST use provided tools for all board changes.',
  'Never invent IDs. Use IDs returned from tool results.',
  'Prefer getBoardState when object lookup is needed.',
  'Respect viewportCenter when placing new content; omit x/y to use deterministic placement near viewport center.',
  'Interpret user-specified coordinates (e.g. "position 100, 200") as viewport pixel coordinates from the caller\'s visible top-left unless the user explicitly says absolute/world coordinates.',
  'Keep commands concise.',
  'If selectedObjectIds is provided in the user payload and the request references "selected", operate on those IDs only.',
  'For structured templates (SWOT/retro/kanban/matrix), create one outer frame plus labeled inner section frames and avoid seed content unless asked.',
  'When creating frames, follow the deterministic sizing/spacing rules from the tool descriptions. Frames must be sized large enough to fully contain all their child items with padding — no child should extend beyond the frame boundary.',
  'When you need to display text, always use sticky notes (createStickyNote) instead of standalone text objects. Stickies are the primary text vehicle on the board.',
  'NEVER overlap elements. Leave clear gaps between all objects. It is perfectly fine to place elements outside the current viewport to avoid overlapping — the user can pan to see them.',
];

export function buildRepoSystemPrompt(ctx: RepoContextForDiagram | LegacyRepoContext): string {
  if ('files' in ctx) {
    const fileSection = ctx.files
      .map((f) => `=== ${f.path} ===\n${f.content}`)
      .join('\n\n');

    return [
      `You are analyzing a GitHub repository to generate a ${ctx.diagramType} diagram on the whiteboard.`,
      `Repository: ${ctx.repoUrl}`,
      ctx.description ? `Description: ${ctx.description}` : '',
      `Primary Language: ${ctx.language}`,
      'Directory Structure:',
      '```',
      ctx.directoryTree,
      '```',
      'Key Files:',
      fileSection,
      'Board rules:',
      ...BOARD_POSITIONING_RULES.map((r) => `- ${r}`),
      'Use only the scanned contents from the provided files. If uncertain, annotate assumptions explicitly.',
    ].filter(Boolean).join('\n');
  }

  const scannedText = ctx.scannedContents
    .slice(0, 30)
    .map((item) => `=== ${item.path} (${item.source}) ===\nReason: ${item.reason}\n${item.snippet}`)
    .join('\n\n');

  return [
    `You are analyzing a GitHub repository to generate a ${ctx.diagramType} diagram on the whiteboard.`,
    `Repository: ${ctx.repoUrl}`,
    `Summary: ${ctx.summary}`,
    `Confidence: ${ctx.confidence}`,
    ctx.knownGaps.length ? `Known gaps: ${ctx.knownGaps.join(' | ')}` : '',
    'Scanned Contents:',
    scannedText,
    'Board rules:',
    ...BOARD_POSITIONING_RULES.map((r) => `- ${r}`),
    'Diagram rules:',
    '- Do not invent modules/entities not present in the scanned contents.',
    '- Use clear labels from the actual codebase where possible.',
    '- If a critical connection is missing, annotate it as an assumption/gap.',
  ].filter(Boolean).join('\n');
}

export function buildRepoBootstrapContext(input: {
  metadata: RepoMetadata;
  tree: FileTreeNode[];
  repoUrl: string;
  branch: string;
  scopedPath?: string;
}): RepoBootstrapContext {
  return {
    repoUrl: input.repoUrl,
    owner: input.metadata.owner,
    repo: input.metadata.repo,
    branch: input.branch,
    scopedPath: input.scopedPath,
    description: input.metadata.description,
    language: input.metadata.language,
    shallowTree: buildDirectoryTree(input.tree, 3),
    fileCountsByExt: summarizeTreeStats(input.tree),
  };
}

export async function runGitHubExplorationPipeline(input: PipelineInput): Promise<GitHubAnalysisResult> {
  const metrics: GitHubAnalysisMetrics = {
    urlDetected: true,
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
  };

  const bootstrapStart = Date.now();
  const bootstrap = buildRepoBootstrapContext({
    metadata: input.metadata,
    tree: input.tree,
    repoUrl: input.repoUrl,
    branch: input.branch,
    scopedPath: input.scopedPath,
  });
  metrics.phaseLatenciesMs.metadataTree = Date.now() - bootstrapStart;

  const planningStart = Date.now();
  let plan: RepoExplorationPlan;
  try {
    plan = planRepoExploration({
      promptWithoutUrl: input.promptWithoutUrl,
      bootstrap,
      tree: input.tree,
    });
  } catch {
    metrics.fallbackPathTaken = 'planner';
    plan = buildFallbackPlan({
      promptWithoutUrl: input.promptWithoutUrl,
      bootstrap,
      tree: input.tree,
    });
  }
  metrics.phaseLatenciesMs.planning = Date.now() - planningStart;
  metrics.diagramType = plan.diagramType;

  const retrievalStart = Date.now();
  const state: RetrievalState = {
    round: 0,
    scannedContents: [],
    touchedFiles: new Set<string>(),
    bytesFetched: 0,
    knownGaps: [],
    pendingOperations: [...plan.operations],
  };

  for (let round = 1; round <= plan.maxRounds; round++) {
    state.round = round;
    const roundResult = await executeExplorationRound(input, plan, state);
    state.scannedContents.push(...roundResult.addedContents);
    state.pendingOperations = [...roundResult.nextOperations];
    metrics.roundsUsed = round;

    if (roundResult.hardCapError) {
      metrics.phaseLatenciesMs.retrieval = Date.now() - retrievalStart;
      metrics.filesTouched = state.touchedFiles.size;
      metrics.bytesFetched = state.bytesFetched;
      return {
        ok: false,
        userMessage: `GitHub analysis stopped because ${roundResult.hardCapError}. Please narrow the request to a specific subsystem or path.`,
        metrics,
      };
    }

    if (roundResult.completed) break;
    if (state.pendingOperations.length === 0) break;
  }

  metrics.phaseLatenciesMs.retrieval = Date.now() - retrievalStart;
  metrics.filesTouched = state.touchedFiles.size;
  metrics.bytesFetched = state.bytesFetched;

  if (state.scannedContents.length === 0) {
    metrics.fallbackPathTaken = metrics.fallbackPathTaken === 'none' ? 'heuristic' : metrics.fallbackPathTaken;
    return {
      ok: false,
      userMessage: 'GitHub analysis could not retrieve useful scanned contents from this repository scope. Please provide a more specific path or question.',
      metrics,
    };
  }

  const context = buildRepoContextFromScannedContents({
    repoUrl: input.repoUrl,
    diagramType: plan.diagramType,
    description: input.metadata.description,
    language: input.metadata.language,
    shallowTree: bootstrap.shallowTree,
    scannedContents: state.scannedContents,
    knownGaps: state.knownGaps,
  });

  metrics.finalRepoContextTokens = estimateTokens(JSON.stringify(context));
  if (metrics.finalRepoContextTokens > plan.maxTokens) {
    return {
      ok: false,
      userMessage: `GitHub analysis stopped because token budget exceeded (${metrics.finalRepoContextTokens}/${plan.maxTokens}). Please narrow scope and retry.`,
      metrics,
    };
  }

  return {
    ok: true,
    context,
    promptWithoutUrl: input.promptWithoutUrl,
    metrics,
  };
}

/** File selection patterns by diagram type */
const FILE_PATTERNS: Record<DiagramType, RegExp[]> = {
  erd: [
    /schema\.[^/]*$/i,
    /models?\//i,
    /\.prisma$/i,
    /migrations?\//i,
    /entit(y|ies)\//i,
    /\.sql$/i,
    /drizzle/i,
    /knexfile/i,
    /typeorm/i,
  ],
  architecture: [
    /^src\/[^/]*\.(ts|js|go|py|rs)$/i,
    /(^|\/)index\.(ts|js|tsx|jsx)$/i,
    /(^|\/)main\.(ts|js|go|py|rs)$/i,
    /(^|\/)app\.(ts|js|tsx|jsx|py)$/i,
    /(^|\/)server\.(ts|js)$/i,
    /routes?\//i,
    /api\//i,
    /middleware\//i,
    /services?\//i,
    /handlers?\//i,
    /controllers?\//i,
  ],
  component: [
    /components?\//i,
    /\.(tsx|jsx|vue|svelte)$/i,
    /pages?\//i,
    /views?\//i,
    /layouts?\//i,
  ],
  dependency: [
    /^package\.json$/i,
    /^go\.(mod|sum)$/i,
    /^Cargo\.toml$/i,
    /^requirements.*\.txt$/i,
    /^pyproject\.toml$/i,
    /^Gemfile$/i,
    /^build\.gradle/i,
    /^pom\.xml$/i,
    /^composer\.json$/i,
  ],
};

/** Files always worth including regardless of diagram type */
const UNIVERSAL_PATTERNS: RegExp[] = [
  /^README\.md$/i,
  /^package\.json$/i,
  /^tsconfig.*\.json$/i,
  /^docker-compose.*\.ya?ml$/i,
  /^Dockerfile$/i,
];

/** Files to always skip */
const SKIP_PATTERNS: RegExp[] = [
  /node_modules\//,
  /\.git\//,
  /dist\//,
  /build\//,
  /\.next\//,
  /vendor\//,
  /\.lock$/,
  /lock\.json$/,
  /\.min\.(js|css)$/,
  /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|mp3)$/i,
  /\.map$/,
  /\.d\.ts$/,
  /\.test\.(ts|js|tsx|jsx)$/i,
  /\.spec\.(ts|js|tsx|jsx)$/i,
  /__tests__\//i,
  /\.snap$/,
];

export function selectFiles(tree: FileTreeNode[], diagramType: DiagramType): string[] {
  const blobs = tree.filter((n) => n.type === 'blob');
  const candidates = blobs.filter((n) => !SKIP_PATTERNS.some((re) => re.test(n.path)));

  const typePatterns = FILE_PATTERNS[diagramType];
  const selected = new Set<string>();

  for (const node of candidates) {
    if (UNIVERSAL_PATTERNS.some((re) => re.test(node.path))) {
      selected.add(node.path);
    }
  }

  for (const node of candidates) {
    if (typePatterns.some((re) => re.test(node.path))) {
      selected.add(node.path);
    }
  }

  if (diagramType === 'architecture' && selected.size < 5) {
    for (const node of candidates) {
      if (node.path.split('/').length <= 2 && /\.(ts|js|go|py|rs|java)$/i.test(node.path)) {
        selected.add(node.path);
      }
    }
  }

  return [...selected].sort();
}

function prioritizeFiles(paths: string[], diagramType: DiagramType): string[] {
  const typePatterns = FILE_PATTERNS[diagramType];
  const scored = paths.map((path) => {
    let score = 0;

    if (typePatterns.some((re) => re.test(path))) score += 10;

    const depth = path.split('/').length;
    score += Math.max(0, 5 - depth);

    if (/schema|model|entit/i.test(path)) score += 5;
    if (/(index|main|app|server)\./i.test(path)) score += 4;
    if (/package\.json|README/i.test(path)) score += 3;

    return { path, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.path);
}

const TOKEN_BUDGET = 60_000;

export async function buildRepoContext(
  metadata: RepoMetadata,
  tree: FileTreeNode[],
  branch: string,
  diagramType: DiagramType,
  repoUrl: string,
): Promise<LegacyRepoContext> {
  const dirTree = buildDirectoryTree(tree, 3);
  const selectedPaths = selectFiles(tree, diagramType);
  const prioritized = prioritizeFiles(selectedPaths, diagramType);

  const contents = await fetchFileContents(metadata.owner, metadata.repo, prioritized, branch);

  let tokenCount = estimateTokens(dirTree) + 500;
  const files: { path: string; content: string }[] = [];

  for (const path of prioritized) {
    const content = contents.get(path);
    if (!content) continue;

    const fileTokens = estimateTokens(content);
    if (tokenCount + fileTokens > TOKEN_BUDGET) {
      const remaining = TOKEN_BUDGET - tokenCount;
      if (remaining > 200) {
        const truncated = `${content.slice(0, remaining * 4)}\n\n... (truncated)`;
        files.push({ path, content: truncated });
      }
      break;
    }

    files.push({ path, content });
    tokenCount += fileTokens;
  }

  return {
    repoUrl,
    description: metadata.description,
    language: metadata.language,
    directoryTree: dirTree,
    files,
    diagramType,
  };
}
