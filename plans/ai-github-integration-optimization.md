# AI GitHub Integration Optimization Plan

## Objective
Improve GitHub-link analysis so repository exploration is steered by the user's prompt and only fetches what is needed. Add progressive tool disclosure so GitHub exploration tools are only visible to the LLM when a GitHub URL is present.

## Current Constraints in Implementation
- `server/src/ai/boardAgent.ts` currently forces `diagramType = 'architecture'` in the GitHub path, even though the remaining user prompt (`promptWithoutUrl`) may contain explicit diagram intent.
- `server/src/ai/codeAnalyzer.ts` selects files with static regex heuristics before the model sees prompt intent.
- `server/src/ai/github.ts` fetches full file content for a preselected batch (`GITHUB_MAX_FILES`) rather than staged retrieval.
- Repo analysis and board-execution happen in a single tool universe, increasing chance of unnecessary tool calls.

## Target Architecture

### High-Level Flow
1. Detect GitHub URL in user prompt.
   - Keep this as regex-based URL detection (`extractGitHubUrl`); no additional URL intent classifier is required.
2. If no URL: run existing board-only AI flow.
3. If URL exists: enter a GitHub analysis pipeline with progressive tool disclosure.
4. Run a bounded retrieval loop (plan -> minimal fetch -> refine if needed).
5. Build compact evidence-backed context.
6. Switch to board-only toolset and generate diagram on canvas.

### Design Principles
- Prompt-first retrieval, not heuristic-first retrieval.
- Smallest useful context first (head/chunk), deepen only on demand.
- Explicit token and file budgets per round.
- Deterministic stopping conditions.
- Traceability: every included file/chunk has a reason.

## Progressive Tool Disclosure Model

### Phase A: Standard Whiteboard Mode (No GitHub URL)
- Visible tools: board tools only.
- Hidden tools: all repo exploration tools.

### Phase B: GitHub Discovery Mode (GitHub URL present)
- Visible tools: repo discovery + read/search tools.
- Hidden tools: board mutation tools.
- Goal: derive focused evidence set and summary.

### Phase C: Diagram Execution Mode
- Visible tools: board tools only.
- Hidden tools: repo tools.
- Goal: convert evidence summary into board objects.

### Why This Matters
- Reduces tool confusion.
- Avoids repo fetch overhead for non-GitHub prompts.
- Keeps board placement loop clean and deterministic.
- Reduces token use from unused tool definitions.

## Detailed Pipeline

### Stage 1: Prompt and Repo Bootstrap
- Parse prompt for GitHub URL and optional `/tree/{branch}/{path}` scope.
- Fetch only:
  - repository metadata
  - full tree (or scoped subtree)
- Build a compact structural snapshot:
  - shallow directory tree (depth 2-3)
  - file-type histogram
  - key manifests present

Output:
- `RepoBootstrapContext`

### Stage 2: Intent Planning (LLM, minimal context)
Pass to planner model:
- user prompt without URL
- repo metadata
- shallow tree snapshot

Planner returns a strict JSON plan:
- inferred diagram type
- key questions to answer
- candidate paths/directories
- retrieval strategy (head/chunk/search)
- per-round budget and max rounds

Output:
- `RepoExplorationPlan`

### Stage 3: Bounded Retrieval Loop
For each round (max 2-3):
1. Execute planned repo reads/searches.
2. Return compact evidence bundle to model.
3. Model decides:
   - enough evidence -> stop
   - or request targeted reads/chunks only

Hard guards:
- max files read
- max bytes fetched
- max tokens assembled
- max rounds
- On hitting any hard cap, abort diagram execution for that request and return a clear user-facing failure message; do not create or mutate board objects.

Output:
- `EvidenceSet` with provenance.

### Stage 4: Context Packager
Build final repo context from evidence only:
- concise repo summary
- selected modules/entities/dependencies
- cited file snippets/chunks
- confidence and known gaps

Output:
- `RepoContextForDiagram`

### Stage 5: Diagram Generation
Switch to board toolset and run existing board agent loop with:
- repo context as system augmentation
- original user request retained
- strict instruction to avoid assumptions outside evidence

## API and Type Changes

### `server/src/ai/github.ts`
Add granular read/search functions:
- `fetchFileHead(owner, repo, path, branch, maxLines)`
- `fetchFileChunk(owner, repo, path, branch, startLine, endLine)`
- `searchRepoPaths(tree, query, scope?)`
- `searchInFile(owner, repo, path, branch, query, maxMatches)`

Retain existing:
- URL parsing
- metadata fetch
- tree fetch
- full-content fetch (fallback only)

### `server/src/ai/codeAnalyzer.ts`
Refactor into planner + evidence workflow:
- `inferDiagramType(prompt, bootstrap): DiagramType`
- `planRepoExploration(input): RepoExplorationPlan`
- `executeExplorationRound(plan, state): RoundResult`
- `buildRepoContextFromEvidence(evidence): RepoContextForDiagram`

Keep current regex scoring as fallback prior:
- only used when planner output is invalid or empty.

### `server/src/ai/boardAgent.ts`
Split GitHub handling into explicit phases:
- `runGitHubAnalysisPhase(...)`
- `runDiagramExecutionPhase(...)`

Tool binding pattern:
- Phase B: `llm.bindTools(repoTools)`
- Phase C: `llm.bindTools(boardTools)`

Do not expose both tool families in the same loop.

## Proposed Data Contracts

```ts
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

export interface RepoExplorationPlan {
  diagramType: DiagramType;
  questions: string[];
  candidates: Array<{ path: string; reason: string; priority: number }>;
  operations: Array<
    | { kind: 'head'; path: string; maxLines: number }
    | { kind: 'chunk'; path: string; startLine: number; endLine: number }
    | { kind: 'search'; query: string; scope?: string }
  >;
  maxRounds: number;
  maxFiles: number;
  maxTokens: number;
}

export interface EvidenceItem {
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
  evidence: EvidenceItem[];
  confidence: 'high' | 'medium' | 'low';
  knownGaps: string[];
}
```

## Budgeting and Stop Conditions
- Default exploration budget:
  - max rounds: 5
  - max files touched: 25
  - max fetched bytes: 520 KB
  - max final repo-context tokens: 12K-18K (separate from board prompt envelope)
- Early stop when:
  - all planned questions answered
  - confidence is high and no unresolved critical gap
- Force stop when any hard cap is hit.
- When a hard cap is hit:
  - mark analysis as incomplete
  - skip Phase C (board tool execution)
  - return an explicit failure message explaining which limit was exceeded

## Fallback Strategy
If planner fails or returns malformed output:
1. infer diagram type via keyword + simple tree heuristics
2. run current regex-based selector
3. fetch a reduced cap (e.g. 10 files) and continue

If GitHub retrieval partially fails:
- continue with available evidence
- mark `knownGaps`
- instruct generation step to annotate assumptions

## Observability and Metrics
Track for every GitHub analysis:
- URL detected (yes/no)
- diagram type inferred
- repo-tools exposed (yes/no)
- rounds used
- files touched and bytes fetched
- tokens in final repo context
- fallback path taken (none/planner/heuristic)
- latency split:
  - metadata/tree
  - planning
  - retrieval
  - diagram generation

Add to existing AI trace payload in `observability.ts`.

## Security and Safety
- Keep public-repo-only behavior unless auth is explicitly added.
- Preserve file size and timeout guards.
- Prevent path traversal by validating selected paths against fetched tree.
- Reject binary/extremely minified files for context inclusion.

## Rollout Plan

### Phase 1: Foundation
- [x] Add repo phase orchestration and conditional tool exposure in `boardAgent.ts`.
- [x] Add minimal planner contract and validation.
- [x] Keep legacy `buildRepoContext` as fallback.

### Phase 2: Granular Retrieval
- [x] Implement head/chunk/search functions in `github.ts`.
- [x] Implement round-based exploration execution in `codeAnalyzer.ts`.

### Phase 3: Prompt and Context Optimization
- [x] Tighten planner prompt for high-precision file targeting.
- [x] Add evidence citations and gap annotations in context packager.

### Phase 4: Tuning and Hardening
- [x] Tune budgets and round limits on real repos.
- [x] Add retry/backoff and stronger parse guards.
- [x] Promote planner path to default after reliability threshold.

## Test Plan

### Unit Tests
- [x] URL parse/scoping edge cases.
- [x] planner JSON validation and fallback behavior.
- [x] budget enforcement and early-stop logic.
- [x] phase tool gating correctness.

### Integration Tests
- [x] Non-GitHub prompt never exposes repo tools.
- [x] GitHub prompt exposes repo tools only in analysis phase.
- [x] analysis phase output feeds diagram phase correctly.
- [x] malformed planner output still yields useful diagram via fallback.

### Performance Tests
- [x] Compare before/after for:
  - [x] median latency
  - [x] fetched bytes
  - [x] file count touched
  - [x] prompt tokens sent to model

Target:
- [x] at least 30-50% reduction in fetched repo content on average.

## Concrete File-Level Change List
- `server/src/ai/boardAgent.ts`
  - [x] Add two-phase orchestration and toolset gating.
  - [x] Replace one-shot GitHub context build call.
- `server/src/ai/codeAnalyzer.ts`
  - [x] Introduce planner/evidence APIs.
  - [x] Preserve legacy heuristic selector as fallback.
- `server/src/ai/github.ts`
  - [x] Add head/chunk/search retrieval primitives.
- `server/src/ai/observability.ts`
  - [x] Add GitHub-analysis metrics fields.
- `server/src/ai/__tests__/...`
  - [x] Add new unit and integration coverage for planner, retrieval loop, and tool gating.

## Implementation Sequence (Recommended)
1. [x] Add phase gating in `boardAgent.ts` first (lowest risk, immediate correctness gain).
2. [x] Add planner contract + validation in `codeAnalyzer.ts`.
3. [x] Add granular retrieval APIs in `github.ts`.
4. [x] Implement bounded retrieval loop.
5. [x] Add metrics and tests.
6. [x] Tune budgets with benchmark repos.

## Success Criteria
- [x] Repo exploration is prompt-steered and iterative.
- [x] Repo tools are never visible for non-GitHub prompts.
- [x] GitHub prompts use separate analysis and execution phases.
- [x] Average fetched content materially decreases without quality regression.
- [x] Failure modes degrade gracefully with explicit gap reporting.
