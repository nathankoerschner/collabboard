import { describe, expect, test, vi } from 'vitest';
import { Renderer } from '../Renderer.js';

function makeCtx() {
  return {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    measureText: (value: string) => ({ width: value.length * 10 }),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D & { fillText: ReturnType<typeof vi.fn> };
}

describe('Renderer._drawWrappedText', () => {
  test('preserves explicit newlines', () => {
    const renderer = new Renderer();
    const ctx = makeCtx();

    renderer._drawWrappedText(ctx, 'line one\nline two', 10, 20, 1000, 18, '14px sans-serif', '#111');

    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'line one', 10, 20);
    expect(ctx.fillText).toHaveBeenNthCalledWith(2, 'line two', 10, 38);
  });

  test('preserves blank lines between paragraphs', () => {
    const renderer = new Renderer();
    const ctx = makeCtx();

    renderer._drawWrappedText(ctx, 'top\n\nbottom', 0, 0, 1000, 20, '14px sans-serif', '#111');

    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'top', 0, 0);
    expect(ctx.fillText).toHaveBeenNthCalledWith(2, 'bottom', 0, 40);
  });
});
