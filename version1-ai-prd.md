# CollabBoard Version 1 — AI Agent PRD

## Implementation Priority

AI agent is the last major feature added. All canvas primitives (shapes, connectors, frames, rotation, text) must be solid before AI agent work begins.

---

## AI Board Agent

### Architecture

- **LLM Provider:** OpenAI (GPT-4) via the OpenAI SDK with function calling.
- **Execution model:** Dedicated headless Yjs client on the server. The AI agent connects to the board's Yjs room like any other user, ensuring all writes flow through the same sync path.
- **Concurrency:** Fully parallel. Multiple users can issue AI commands simultaneously. Yjs CRDT handles merge conflicts. No global or per-user queuing.
- **Statefulness:** Stateless — each command is independent. The AI receives the current board state + the user's prompt. No conversation memory across commands.
- **Attribution:** None. AI-created objects are visually indistinguishable from user-created objects. `createdBy` is set to an AI user ID in metadata but has no visual indicator.

### Placement Strategy

**Viewport-relative:** AI places new content relative to the requesting user's current viewport center. The client sends viewport coordinates along with the AI command. This naturally avoids overlap when different users request commands from different viewport positions.

### UI: Command Bar (Cmd+K)

- Floating overlay triggered by `Cmd+K` (Mac) / `Ctrl+K` (Windows/Linux).
- **Natural language only** — no slash commands. All input goes to the LLM.
- Shows autocomplete suggestions for common prompts (e.g., "Create a SWOT analysis", "Make a retro board", "Arrange selected items in a grid").
- Displays a loading spinner while the AI processes.
- Dismisses automatically after the AI completes execution.
- Error state: shows error message inline if the AI fails.

### Batch Execution with Staggered Animation

AI executes all tool calls server-side, then commits to Yjs in a single transaction. On the client, AI-created objects animate in with a brief staggered fade/scale-in effect (e.g., 50ms delay between each object appearing). This provides a polished reveal without showing intermediate states.

### Tool Schema

```
createStickyNote(text, x, y, color)
createShape(type: "rectangle" | "ellipse", x, y, width, height, color)
createFrame(title, x, y, width, height)
createConnector(fromId?, toId?, fromPoint?, toPoint?, style: "line" | "arrow")
createText(content, x, y, fontSize?, bold?, italic?)
moveObject(objectId, x, y)
resizeObject(objectId, width, height)
updateText(objectId, newText)
changeColor(objectId, color)
rotateObject(objectId, angleDegrees)
deleteObject(objectId)
getBoardState()
```

### AI Agent Performance

| Metric | Target |
| --- | --- |
| Response latency | <2 seconds for single-step commands |
| Command breadth | 6+ command types |
| Complexity | Multi-step operation execution (e.g., full SWOT template) |
| Reliability | Consistent, accurate execution |

### Shared AI State

- All users see AI-generated results in real-time via Yjs sync.
- Multiple users can issue AI commands simultaneously without conflict.

### Testing Scenarios

1. Concurrent AI commands from multiple users (parallel execution, no overlap at different viewports)

---

## Observability

**Langfuse** for AI agent tracing only. No general application APM.

Traced events:
- LLM request/response (prompt, completion, model, token usage)
- Tool call invocations (function name, arguments, result)
- End-to-end latency per AI command
- Error rates and failure modes
