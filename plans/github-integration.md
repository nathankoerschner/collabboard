# GitHub Repo → Diagram Generation

## Overview

Users paste a public GitHub repo URL into the AI command bar and the system generates diagrams (architecture, ERD, dependency, component) on the canvas. Integrates into the existing AI command flow with no new UI — just a smarter prompt pipeline.

---

## Architecture

```
User types: "diagram https://github.com/user/repo"
  → AiCommandBar submits as normal AI command
  → Server detects GitHub URL in prompt
  → GitHubFetcher pulls repo structure via GitHub API
  → CodeAnalyzer distills code into structured summary
  → Summary injected into LLM context as augmented prompt
  → Existing agent loop creates objects via board tools
  → Diagram appears on canvas via Yjs sync
```

No new client code beyond minor UX polish. All new logic lives server-side.

---

## Implementation Steps

### 1. GitHub Fetcher Service

**File:** `server/src/ai/github.ts`

Responsible for fetching repo structure and file contents from the GitHub REST API.

**Functions:**

```
parseGitHubUrl(url: string) → { owner, repo, path?, branch? }
  - Accept formats: github.com/owner/repo, github.com/owner/repo/tree/branch/path
  - Return null if not a valid GitHub URL

fetchRepoTree(owner, repo, branch?) → FileTreeNode[]
  - GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
  - Return flat list: { path, type: 'blob'|'tree', size }
  - Default branch: use repo default via GET /repos/{owner}/{repo}

fetchFileContents(owner, repo, paths: string[], branch?) → Map<string, string>
  - GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
  - Decode base64 content
  - Batch with Promise.all, cap at ~30 files per request
  - Skip files > 100KB
```

**Auth:** Optional `GITHUB_TOKEN` env var for higher rate limits (5000/hr vs 60/hr). Pass as `Authorization: Bearer` header when present.

**Error handling:** Return structured errors (repo not found, rate limited, private repo) so the LLM can explain to the user.

---

### 2. Code Analyzer / File Selector

**File:** `server/src/ai/codeAnalyzer.ts`

Selects relevant files from the tree and builds a structured summary for the LLM.

**Phase 1 — Heuristic file selection:**

Select files by diagram type using glob patterns:

| Diagram Intent | File Patterns |
|---|---|
| ERD / Data Model | `**/schema.*`, `**/models/**`, `**/*.prisma`, `**/migrations/**`, `**/entities/**` |
| Architecture | `**/src/**/index.*`, `**/main.*`, `**/app.*`, `**/server.*`, `**/routes/**` |
| Dependency | `package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`, `pyproject.toml` |
| Component | `**/components/**`, `**/*.tsx`, `**/*.vue`, `**/*.svelte` |
| General | Top-level config + `src/` first-level files + README |

Always include: `README.md`, directory tree (truncated to depth 3).

**Phase 2 — Build context payload:**

```typescript
interface RepoContext {
  repoUrl: string
  description: string         // from GitHub API
  language: string            // primary language
  directoryTree: string       // ASCII tree, depth 3
  files: { path: string, content: string }[]  // selected files
  diagramType: string         // detected or default
  totalTokenEstimate: number  // rough count for budget
}
```

**Token budget:** Cap total file content at ~60K tokens. If over budget, prioritize by:
1. Schema/model files
2. Entry points and config
3. Route/handler files
4. Everything else (truncate or omit)

---

### 3. Prompt Detection & Routing

**File:** `server/src/ai/boardAgent.ts` (modify existing)

Add GitHub URL detection before the main LLM loop.

```
In executeBoardAICommand():
  1. Regex match GitHub URL in prompt
  2. If found:
     a. Parse URL → { owner, repo, path, branch }
     b. Fetch repo tree
     c. Detect diagram type from prompt keywords + repo content
     d. Fetch relevant files via codeAnalyzer
     e. Build augmented system prompt with repo context
     f. Replace/augment human message with structured request
  3. Continue into existing LLM tool-call loop
```

**Diagram type detection** — scan prompt for keywords:
- "erd", "data model", "schema", "database" → ERD
- "architecture", "system", "overview", "modules" → Architecture
- "components", "component tree", "ui" → Component
- "dependencies", "dep graph" → Dependency
- No keyword → Architecture (default)

**Augmented system prompt addition:**

```
You are analyzing a GitHub repository to generate a {diagramType} diagram.

Repository: {repoUrl}
Description: {description}
Primary Language: {language}

Directory Structure:
{directoryTree}

Key Files:
{for each file: === {path} ===\n{content}\n}

Instructions:
- Analyze the code structure and create a clear {diagramType} diagram
- Use frames to group related modules/components
- Use connectors to show relationships/dependencies
- Use tables for entity schemas with columns for field name, type, constraints
- Label everything clearly
- Arrange objects in a logical layout (top-down or left-right flow)
- Place the diagram centered on the viewport
```

---

### 4. Layout Strategy for Generated Diagrams

The LLM already handles placement via the existing tools, but add guidance in the system prompt for repo diagrams specifically:

**Architecture diagrams:**
- Outer frame titled "{repo} Architecture"
- Inner frames for each major module/layer (e.g., "API Layer", "Data Layer", "Services")
- Stickies or shapes for individual components within frames
- Connectors showing data flow / dependencies between modules

**ERD diagrams:**
- Use `createTable` for each entity/model
- Columns: field name, type, constraints
- Connectors between tables for relationships (FK → PK)
- Label connectors with relationship type (1:N, M:N)

**Component diagrams:**
- Tree structure using shapes + connectors
- Group by directory/feature using frames
- Props/interfaces as text labels

**Dependency diagrams:**
- Central node for the project
- Surrounding nodes for dependencies
- Group by: runtime vs dev, internal vs external

---

### 5. Error Handling & Edge Cases

| Case | Handling |
|---|---|
| Invalid/malformed URL | LLM responds with "I couldn't parse that GitHub URL" |
| Repo not found / 404 | Return error context to LLM, it explains to user |
| Private repo | Explain repo is private, suggest providing a GitHub token |
| Rate limited (GitHub API) | Return 429 info, LLM tells user to try again later |
| Very large repo (>1000 files) | Heuristic filter aggressively, warn LLM about partial view |
| Empty/minimal repo | LLM creates simple diagram, notes limited content |
| Prompt has URL + other instructions | Combine: fetch repo context + honor user's specific request |
| Timeout (GitHub API slow) | 30s timeout on fetch, abort and explain |

---

### 6. Configuration & Environment

```env
# .env additions
GITHUB_TOKEN=ghp_...          # Optional, for higher rate limits
GITHUB_FETCH_TIMEOUT=30000    # ms, default 30s
GITHUB_MAX_FILES=30           # max files to fetch content for
GITHUB_MAX_FILE_SIZE=102400   # skip files larger than 100KB
```

---

## File Changes Summary

| File | Change |
|---|---|
| `server/src/ai/github.ts` | **New** — GitHub API fetcher (parseUrl, fetchTree, fetchFiles) |
| `server/src/ai/codeAnalyzer.ts` | **New** — File selection heuristics, context builder |
| `server/src/ai/boardAgent.ts` | **Modify** — Add GitHub URL detection, repo context injection |
| `server/.env.example` | **Modify** — Add GITHUB_TOKEN and related vars |

---

## Implementation Order

1. `github.ts` — URL parser + tree fetcher + file fetcher
2. `codeAnalyzer.ts` — File selector + context builder
3. `boardAgent.ts` — URL detection + prompt augmentation
4. Test with small repos first (< 20 files), iterate on prompt quality
5. Test with medium repos, tune token budget and file selection
6. Add error handling for edge cases

---

## Future Enhancements (not in v1)

- **Subdirectory scoping** — "diagram https://github.com/user/repo/tree/main/src/api"
- **Diagram type picker UI** — modal after URL detection asking what kind of diagram
- **Caching** — cache repo trees for 5 min to avoid repeated fetches
- **Streaming** — stream objects onto canvas as the LLM generates them
- **User GitHub auth** — OAuth flow for private repo access
- **Incremental updates** — "update this diagram" re-fetches and diffs
