# Toolcall Optimization Plan

## Goals
- Reduce end-to-end AI command latency.
- Decrease LLM round-trips per command.
- Keep tool-call reliability high under malformed or over-long plans.

## Implemented
1. Planner-first execution path in `server/src/ai/boardAgent.ts`.
2. Fallback multi-round tool loop retained for reliability.
3. Lower default max tool rounds from 8 to 4.
4. Shortened runtime system prompt and tool descriptions.
5. Cached tool definitions to avoid per-request schema rebuild.
6. Added scoped read tools:
   - `getObjectById`
   - `listObjectsByType`
   - `getObjectsInViewport`
7. Added batch mutation tools:
   - `createObjectsBatch`
   - `updateObjectsBatch`
   - `deleteObjectsBatch`
8. Added composite layout tool:
   - `createStructuredTemplate`
9. Added planner/LLM usage metrics in command result + trace outputs.
10. Expanded test coverage for all new tool surfaces.

## Next Validation Steps
1. Run benchmark prompts and compare p50/p95 latency vs. previous baseline.
2. Measure planner-hit rate (commands completed without fallback loop).
3. Track average token usage reduction and tool-call count per command.
4. Tune prompt and tool descriptions further if complex prompts still spill into fallback too often.
