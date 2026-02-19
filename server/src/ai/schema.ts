import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const AI_TOOL_NAMES = [
  'createStickyNote',
  'createShape',
  'createFrame',
  'createConnector',
  'createText',
  'moveObject',
  'resizeObject',
  'updateText',
  'changeColor',
  'rotateObject',
  'deleteObject',
  'getBoardState',
] as const;

export const OBJECT_TYPES = ['sticky', 'rectangle', 'ellipse', 'text', 'connector', 'frame'] as const;
export const SHAPE_TYPES = ['rectangle', 'ellipse'] as const;
export const CONNECTOR_STYLES = ['line', 'arrow'] as const;
export const TEXT_SIZES = ['small', 'medium', 'large'] as const;
export const PALETTE_NAMES = ['yellow', 'blue', 'green', 'pink', 'purple', 'orange', 'red', 'teal', 'gray', 'white'] as const;

export const DEFAULT_VIEWPORT_CENTER = { x: 0, y: 0 };

export interface Point {
  x: number;
  y: number;
}

export function clampNumber(value: unknown, min: number, max: number, fallback = min): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function normalizeViewportCenter(input: unknown): Point {
  if (!input || typeof input !== 'object') return { ...DEFAULT_VIEWPORT_CENTER };
  const obj = input as Record<string, unknown>;
  return {
    x: clampNumber(obj.x, -100000, 100000, 0),
    y: clampNumber(obj.y, -100000, 100000, 0),
  };
}

export function normalizeAngle(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const out = ((n % 360) + 360) % 360;
  return out > 180 ? out - 360 : out;
}

export function sanitizeColor(value: unknown, fallback = 'gray'): string {
  if (typeof value !== 'string') return fallback;
  return (PALETTE_NAMES as readonly string[]).includes(value) ? value : fallback;
}

export function clampText(value: unknown, max = 2000, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, max);
}

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {};
}

export function validateToolArgs(toolName: string, rawArgs: unknown = {}): Record<string, unknown> {
  const args = asObject(rawArgs);

  if (toolName === 'createStickyNote') {
    return {
      text: clampText(args.text ?? '', 2000, ''),
      x: typeof args.x === 'number' ? clampNumber(args.x, -100000, 100000, 0) : null,
      y: typeof args.y === 'number' ? clampNumber(args.y, -100000, 100000, 0) : null,
      width: clampNumber(args.width, 24, 2000, 150),
      height: clampNumber(args.height, 24, 2000, 150),
      color: sanitizeColor(args.color, 'yellow'),
    };
  }

  if (toolName === 'createShape') {
    return {
      type: (SHAPE_TYPES as readonly string[]).includes(args.type as string) ? args.type : 'rectangle',
      x: typeof args.x === 'number' ? clampNumber(args.x, -100000, 100000, 0) : null,
      y: typeof args.y === 'number' ? clampNumber(args.y, -100000, 100000, 0) : null,
      width: clampNumber(args.width, 24, 2000, 200),
      height: clampNumber(args.height, 24, 2000, 120),
      color: sanitizeColor(args.color, args.type === 'ellipse' ? 'teal' : 'blue'),
    };
  }

  if (toolName === 'createFrame') {
    return {
      title: clampText(args.title ?? 'Frame', 160, 'Frame'),
      x: typeof args.x === 'number' ? clampNumber(args.x, -100000, 100000, 0) : null,
      y: typeof args.y === 'number' ? clampNumber(args.y, -100000, 100000, 0) : null,
      width: clampNumber(args.width, 120, 4000, 360),
      height: clampNumber(args.height, 120, 4000, 240),
    };
  }

  if (toolName === 'createConnector') {
    const fp = args.fromPoint as Record<string, unknown> | null;
    const tp = args.toPoint as Record<string, unknown> | null;
    return {
      fromId: typeof args.fromId === 'string' ? args.fromId : null,
      toId: typeof args.toId === 'string' ? args.toId : null,
      fromPoint: fp && typeof fp === 'object'
        ? { x: clampNumber(fp.x, -100000, 100000, 0), y: clampNumber(fp.y, -100000, 100000, 0) }
        : null,
      toPoint: tp && typeof tp === 'object'
        ? { x: clampNumber(tp.x, -100000, 100000, 0), y: clampNumber(tp.y, -100000, 100000, 0) }
        : null,
      style: (CONNECTOR_STYLES as readonly string[]).includes(args.style as string) ? args.style : 'arrow',
    };
  }

  if (toolName === 'createText') {
    return {
      content: clampText(args.content ?? '', 4000, ''),
      x: typeof args.x === 'number' ? clampNumber(args.x, -100000, 100000, 0) : null,
      y: typeof args.y === 'number' ? clampNumber(args.y, -100000, 100000, 0) : null,
      width: clampNumber(args.width, 24, 2000, 220),
      height: clampNumber(args.height, 24, 2000, 60),
      fontSize: (TEXT_SIZES as readonly string[]).includes(args.fontSize as string) ? args.fontSize : 'medium',
      bold: Boolean(args.bold),
      italic: Boolean(args.italic),
      color: sanitizeColor(args.color, 'gray'),
    };
  }

  if (toolName === 'moveObject') {
    return {
      objectId: typeof args.objectId === 'string' ? args.objectId : null,
      x: clampNumber(args.x, -100000, 100000, 0),
      y: clampNumber(args.y, -100000, 100000, 0),
    };
  }

  if (toolName === 'resizeObject') {
    return {
      objectId: typeof args.objectId === 'string' ? args.objectId : null,
      width: clampNumber(args.width, 24, 4000, 120),
      height: clampNumber(args.height, 24, 4000, 80),
    };
  }

  if (toolName === 'updateText') {
    return {
      objectId: typeof args.objectId === 'string' ? args.objectId : null,
      newText: clampText(args.newText ?? '', 4000, ''),
    };
  }

  if (toolName === 'changeColor') {
    return {
      objectId: typeof args.objectId === 'string' ? args.objectId : null,
      color: sanitizeColor(args.color, 'gray'),
    };
  }

  if (toolName === 'rotateObject') {
    return {
      objectId: typeof args.objectId === 'string' ? args.objectId : null,
      angleDegrees: normalizeAngle(args.angleDegrees),
    };
  }

  if (toolName === 'deleteObject') {
    return {
      objectId: typeof args.objectId === 'string' ? args.objectId : null,
    };
  }

  return {};
}

export function toToolDefinitions(): ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'createStickyNote',
        description: 'Create a sticky note. Default size is 150x150. Omit x/y to place near viewport center. When placing inside a frame, set x/y within the frame bounds so it becomes a child of that frame.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            color: { type: 'string', enum: [...PALETTE_NAMES] },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createShape',
        description: 'Create a rectangle or ellipse. Default size is 200x120.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...SHAPE_TYPES] },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            color: { type: 'string', enum: [...PALETTE_NAMES] },
          },
          required: ['type'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createFrame',
        description: 'Create a labeled section container. Use frames for categories/quadrants/columns where users will later add stickies. Width/height are the ACTUAL frame dimensions (outer bounds). Frame title bar height is 32px and should remain reserved for title/selection behavior. Deterministic sticky-fit sizing: size section frames to fit 6 default stickies in a 3x2 grid with fixed 24px gaps. With 150x150 stickies, required note area is 498x324 (3*150 + 2*24 by 2*150 + 24). Add fixed 24px inner padding on all sides of that note area and keep it below the title bar, so minimum ACTUAL section frame size is 546x404. For placement/containment, always use ACTUAL frame dimensions (not usable dimensions). Keep sibling spacing deterministic with fixed 24px gaps, fixed 24px parent padding, and left-to-right then top-to-bottom placement. For N equal columns use columnWidth = floor((parentUsableWidth - (N - 1) * 24) / N). Outside-frame wrap rule: include ALL generated section-fill frames when computing outer bounds. Account for the top title bar by reserving (32 + 24) at the top of inner content, then compute deterministic outer bounds from inner extents: left = minInnerX - 24, top = minInnerY - (32 + 24), right = maxInnerRight + 24, bottom = maxInnerBottom + 24.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createConnector',
        description: 'Create connector between objects or points. Connectors have a default size of 0x0.',
        parameters: {
          type: 'object',
          properties: {
            fromId: { type: 'string' },
            toId: { type: 'string' },
            fromPoint: {
              type: 'object',
              properties: { x: { type: 'number' }, y: { type: 'number' } },
              required: ['x', 'y'],
              additionalProperties: false,
            },
            toPoint: {
              type: 'object',
              properties: { x: { type: 'number' }, y: { type: 'number' } },
              required: ['x', 'y'],
              additionalProperties: false,
            },
            style: { type: 'string', enum: [...CONNECTOR_STYLES] },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createText',
        description: 'Create a text object. Default size is 220x60.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            fontSize: { type: 'string', enum: [...TEXT_SIZES] },
            bold: { type: 'boolean' },
            italic: { type: 'boolean' },
            color: { type: 'string', enum: [...PALETTE_NAMES] },
          },
          required: ['content'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'moveObject',
        description: 'Move an object to absolute x/y world coordinates.',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['objectId', 'x', 'y'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'resizeObject',
        description: 'Resize an object; keeps top-left anchored.',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          required: ['objectId', 'width', 'height'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'updateText',
        description: 'Update text content on a sticky or text object.',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            newText: { type: 'string' },
          },
          required: ['objectId', 'newText'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'changeColor',
        description: 'Update object color using palette token.',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            color: { type: 'string', enum: [...PALETTE_NAMES] },
          },
          required: ['objectId', 'color'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'rotateObject',
        description: 'Rotate object by setting angle in degrees.',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
            angleDegrees: { type: 'number' },
          },
          required: ['objectId', 'angleDegrees'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'deleteObject',
        description: 'Delete an object by id.',
        parameters: {
          type: 'object',
          properties: {
            objectId: { type: 'string' },
          },
          required: ['objectId'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getBoardState',
        description: 'Read compact board state for planning tool calls.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
  ];
}
