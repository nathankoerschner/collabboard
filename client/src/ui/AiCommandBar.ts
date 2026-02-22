import { runAICommand } from '../api.js';

interface AiCommandBarOptions {
  container: HTMLElement;
  boardId: string;
  getCanvas: () => import('../canvas/Canvas.js').Canvas | null;
  getUser: () => Record<string, unknown> | null;
  aiToggleBtn: HTMLElement | null;
}

export class AiCommandBar {
  private aiBar: HTMLElement;
  private aiForm: HTMLElement;
  private aiInput: HTMLInputElement;
  private aiBackdrop: HTMLElement;
  private aiToast: HTMLElement;
  private aiWorking: HTMLElement;
  private aiBubble: HTMLElement;
  private aiToggleBtn: HTMLElement | null;

  private boardId: string;
  private getCanvas: () => import('../canvas/Canvas.js').Canvas | null;
  private getUser: () => Record<string, unknown> | null;

  private panelOpen = false;
  private submitting = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private bubbleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: AiCommandBarOptions) {
    this.boardId = opts.boardId;
    this.getCanvas = opts.getCanvas;
    this.getUser = opts.getUser;
    this.aiToggleBtn = opts.aiToggleBtn;

    this.aiBar = opts.container.querySelector('#ai-command-bar')!;
    this.aiForm = opts.container.querySelector('#ai-command-form')!;
    this.aiInput = opts.container.querySelector('#ai-command-input') as HTMLInputElement;
    this.aiBackdrop = opts.container.querySelector('#ai-backdrop')!;
    this.aiToast = opts.container.querySelector('#ai-toast')!;
    this.aiWorking = opts.container.querySelector('#ai-working')!;
    this.aiBubble = opts.container.querySelector('#ai-bubble')!;

    this.aiToggleBtn?.addEventListener('click', () => this.toggle());
    this.aiBackdrop.addEventListener('click', () => this.close());
    this.aiForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.submit(this.aiInput.value);
    });
  }

  toggle(): void {
    this.syncPanel(!this.panelOpen);
  }

  open(): void {
    this.syncPanel(true);
  }

  close(): void {
    this.syncPanel(false);
  }

  isOpen(): boolean {
    return this.panelOpen;
  }

  showBubble(message: string): void {
    this.aiBubble.textContent = message;
    this.aiBubble.classList.add('visible');
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => {
      this.aiBubble.classList.remove('visible');
      this.bubbleTimer = null;
    }, 3000);
  }

  showToast(message: string): void {
    this.aiToast.textContent = message;
    this.aiToast.classList.add('visible');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.aiToast.classList.remove('visible');
      this.toastTimer = null;
    }, 4000);
  }

  async submit(prompt: string): Promise<void> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || this.submitting) return;

    this.submitting = true;
    this.syncPanel(false);
    this.aiToggleBtn?.classList.add('ai-processing');

    const canvas = this.getCanvas();
    canvas?.undoRedoManager.snapshotForAI();

    try {
      const user = this.getUser();
      const viewport = canvas!.getViewportSnapshot();
      const result = await runAICommand(this.boardId, {
        prompt: trimmedPrompt,
        viewportCenter: {
          x: viewport.center.x,
          y: viewport.center.y,
          widthPx: viewport.widthPx,
          heightPx: viewport.heightPx,
          topLeftWorld: viewport.topLeftWorld,
          bottomRightWorld: viewport.bottomRightWorld,
          scale: viewport.scale,
        },
        selectedObjectIds: canvas!.getSelectedIds(),
        userId: (user as Record<string, unknown>)?.id || (user as Record<string, unknown>)?.sub || 'anonymous',
      });

      const r = result as { createdIds?: string[]; updatedIds?: string[]; deletedIds?: string[] };
      const totalMutations = (r.createdIds?.length || 0) + (r.updatedIds?.length || 0) + (r.deletedIds?.length || 0);
      if (totalMutations === 0) {
        this.showBubble("Not sure what to do with that");
      }

      canvas?.undoRedoManager.pushAIUndoEntry(r);
    } catch (err: unknown) {
      this.showToast((err as Error)?.message || 'AI command failed');
    } finally {
      this.submitting = false;
      if (this.aiToggleBtn) {
        this.aiToggleBtn.classList.add('ai-stopping');
        const svg = this.aiToggleBtn.querySelector('svg');
        const btn = this.aiToggleBtn;
        const onCycleEnd = () => {
          btn.classList.remove('ai-processing', 'ai-stopping');
          svg?.removeEventListener('animationiteration', onCycleEnd);
        };
        svg?.addEventListener('animationiteration', onCycleEnd);
        setTimeout(onCycleEnd, 2000);
      }
    }
  }

  private syncPanel(isOpen: boolean): void {
    this.panelOpen = isOpen;
    this.aiBar.classList.toggle('visible', isOpen);
    this.aiBackdrop.classList.toggle('visible', isOpen);
    this.aiBar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    this.aiToggleBtn?.classList.toggle('active', isOpen);

    if (isOpen && this.submitting) {
      this.aiForm.hidden = true;
      this.aiWorking.hidden = false;
    } else if (isOpen) {
      this.aiForm.hidden = false;
      this.aiWorking.hidden = true;
      this.aiInput.focus();
    }

    if (!isOpen) {
      this.aiInput.value = '';
      this.aiInput.blur();
    }
  }

  destroy(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
  }
}
