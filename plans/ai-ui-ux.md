# AI Command Bar UI/UX Redesign

## Overview
Redesign the AI command bar from a card-style panel to a minimal, Spotlight-inspired floating input centered on the viewport. Add a backdrop scrim, move the loading state to the toolbar icon, and show errors via toast.

---

## Visual Design

### Command Bar (Idle/Open State)
- **Position**: Horizontally and vertically centered in the viewport (true Spotlight placement)
- **Style**: No visible card border. Just the input + a soft shadow. Minimal wrapper with tight spacing.
- **Title**: Keep small "Ask AI" label above the input inside a minimal container
- **Input**: Single text input with placeholder `"Ask AI anything..."`
- **Submit button**: Keep the "Run" button to the right of the input (aids discoverability)
- **Suggestion chips**: Remove entirely
- **Shortcut hint**: Update the AI toolbar button tooltip to read `"Ask AI | ⌘K"`

### Backdrop Overlay
- **Coverage**: Canvas area only — toolbar remains uncovered and accessible
- **Style**: Light scrim, ~20% black (`rgba(0,0,0,0.2)`)
- **Interaction**: Clicking the backdrop dismisses the command bar
- **z-index**: Below the command bar, above the canvas

### Open/Close Animation
- **Open**: Scale up from center + fade in (starts small ~0.95 scale, grows to 1.0)
- **Close**: Reverse — scale down + fade out
- **Duration**: ~150-200ms, ease-out

---

## Interaction Flow

### Opening
1. User clicks AI sparkle button in toolbar, or presses `Cmd+K` / `Ctrl+K`
2. Backdrop scrim fades in over the canvas
3. Command bar scales up in center of viewport
4. Input is auto-focused

### Submitting
1. User types a prompt and clicks "Run" or presses Enter
2. Command bar closes immediately (scale-down animation)
3. Backdrop scrim fades out
4. Input text is cleared
5. AI toolbar button: the sparkle SVG icon begins **slow continuous rotation** to indicate processing
6. The button remains in an `active`/highlighted state while processing

### During Processing
- The sparkle icon rotates continuously (CSS animation)
- Clicking the sparkle button (or pressing `Cmd+K`) reopens the command bar in a **"Working.." state**:
  - Shows text "Working.." (no input field, no submit button)
  - No cancel button — closing the bar just hides it, AI continues in background
  - Backdrop scrim appears as normal
- Closing the "Working.." bar (Escape, backdrop click, or button click) just hides it — processing continues

### Completion — Success
- Sparkle icon stops rotating, returns to normal static state
- Button loses `active` highlight
- No toast or notification — the objects appearing on the board is the feedback

### Completion — Error
- Sparkle icon stops rotating, returns to normal state
- Button loses `active` highlight
- **Error toast** appears:
  - Position: bottom center of viewport
  - Auto-dismiss after 4 seconds
  - Shows the error message text
  - Standard toast styling (small rounded bar with error text)

---

## Edge Cases

### Dismiss Without Submitting
- Escape key, backdrop click, or clicking the AI button all close the bar
- **Input text is cleared on close** — fresh start every time

### Cmd+K During Processing
- Same behavior as clicking the icon: reopens the command bar in "Working.." state

### Multiple Rapid Submissions
- While `aiSubmitting` is true, the submit flow is blocked (existing guard)

---

## Implementation Notes

### HTML Changes (board.ts)
- Remove the 3 `.ai-suggestion-chip` buttons and the `.ai-suggestions` container
- Add a backdrop `<div class="ai-backdrop" id="ai-backdrop"></div>` before the command bar
- Add a toast container `<div class="ai-toast" id="ai-toast"></div>` at the end of the board container
- Update the command bar to show "Working.." text when in processing state

### CSS Changes (board.css)
- `.ai-command-bar`: Reposition to `top: 50%; left: 50%; transform: translate(-50%, -50%)`. Remove border. Increase shadow. Add `transform-origin: center` for scale animation.
- Remove `.ai-command-bar.visible` slide-down, replace with scale-up: `transform: translate(-50%, -50%) scale(1); opacity: 1`
- Default (hidden): `transform: translate(-50%, -50%) scale(0.95); opacity: 0`
- Remove all `.ai-suggestion-*` styles
- Add `.ai-backdrop` styles: fixed/absolute cover, `rgba(0,0,0,0.2)`, z-index below command bar, fade transition. Should only cover canvas area (not toolbar).
- Add `.ai-toast` styles: fixed bottom center, auto-hide animation
- Add `@keyframes ai-icon-spin` for the toolbar sparkle rotation
- Add `.toolbar-btn.ai-processing svg` rotation animation (slow, continuous)

### JS Changes (board.ts)
- `syncAiPanel()`: Also toggle backdrop visibility. Clear input on close.
- `submitAICommand()`: After closing the bar, add `ai-processing` class to the AI button. On completion, remove it.
- Add "Working.." state: when bar opens during `aiSubmitting`, show "Working.." text instead of the form
- Error handling: instead of setting `aiError.textContent`, call a `showToast(message)` helper
- Toast helper: creates/shows toast element, auto-removes after 4 seconds
- Update tooltip on AI button to `"Ask AI | ⌘K"`
- Backdrop click handler: close the command bar

### Sparkle Icon Animation
- Use CSS class `.ai-processing` on the toolbar button
- Animation: `animation: ai-icon-spin 2s linear infinite` (slow rotation)
- Applied to the SVG element inside the button
