# AI Feature Implementation Plan

## Recommendation

Use a dedicated server-side AI board worker (agent component), but do **not** use the OpenAI Agents SDK for v1.

For this PRD, plain OpenAI SDK tool-calling is the better fit: stateless single-command execution, strict transaction control in Yjs, lower complexity, and easier latency tuning.

## Implementation Plan

1. **Gate AI behind canvas readiness**
   - Confirm shapes/connectors/frames/rotation/text are complete first (per PRD).
   - Freeze AI scope to the tool list in `version1-ai-prd.md`.

2. **Define canonical board schema for AI tools**
   - Add shared validation/types for tool args and board objects in server code (e.g. `server/src/ai/schema.js`).
   - Enforce palette and object-type constraints so the LLM cannot write invalid data.

3. **Create AI command API endpoint**
   - Add `POST /api/boards/:id/ai/command` in `server/src/routes/boards.js` (or a dedicated `server/src/routes/ai.js`).
   - Request body: `{ prompt, viewportCenter: { x, y }, userId }`.
   - Response: `{ createdIds, updatedIds, deletedIds, durationMs }`.

4. **Build dedicated headless Yjs client executor**
   - Add `server/src/ai/boardAgent.js` that joins the board room as a server Yjs client.
   - Read current board state, run LLM tool-calling, apply all mutations in **one Yjs transaction**.

5. **Implement server-authoritative tool layer**
   - Map PRD tools (`createStickyNote`, `moveObject`, `createConnector`, etc.) to Yjs mutations.
   - Implement `getBoardState()` tool returning compact normalized board state.
   - Add strict argument validation and clamping (sizes, angles, colors, missing refs).

6. **Implement viewport-relative placement strategy**
   - Use `viewportCenter` from client request as placement anchor.
   - Add deterministic layout helpers for templates (SWOT, retro board, grid) to reduce overlap/variance.

7. **Add client command bar (Cmd/Ctrl+K)**
   - Add UI in `client/src/views/board.js` with styles in `client/src/styles/board.css`.
   - Include suggestions, loading spinner, inline error, auto-dismiss on success.
   - Send current viewport center from camera state with each AI command.

8. **Add staggered reveal animation**
   - Tag AI-created objects via metadata (`createdBy: "ai:<id>"`, `createdAt`).
   - In `client/src/canvas/Canvas.js`/`Renderer.js`, animate newly observed AI-created objects with ~50ms stagger.

9. **Add LangSmith observability (AI only)**
   - Trace LLM request/response metadata, tool calls, latency, and errors.
   - Keep sensitive board text handling configurable/redacted.

10. **Test concurrency and reliability**
   - Test simultaneous AI requests on the same board from different viewport centers.
   - Validate invalid prompts/tool args, timeout handling, and merge behavior under load.
   - Track p50/p95 latency; target `<2s` for simple commands.

11. **Rollout safely**
   - Add a feature flag for AI endpoint + Cmd+K UI.
   - Ship in phases: create/update/move/delete/text/color first; connectors/frames/rotation next.
   - Add rate limiting and per-user quotas before broad rollout.

## Why not Agents SDK for v1

- PRD workflow is single-turn, stateless, and tool-calling focused.
- Need strict control of exactly what and when to commit into Yjs.
- LangSmith is already selected for tracing, reducing need for SDK-level tracing features.
- Fewer moving parts improves delivery speed and debuggability for v1.
