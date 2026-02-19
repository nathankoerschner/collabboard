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
  'getObjectById',
  'listObjectsByType',
  'getObjectsInViewport',
  'createObjectsBatch',
  'updateObjectsBatch',
  'deleteObjectsBatch',
  'createStructuredTemplate',
] as const;

export const OBJECT_TYPES = ['sticky', 'shape', 'text', 'connector', 'frame'] as const;
export const SHAPE_KINDS = [
  'rectangle', 'rounded-rectangle', 'ellipse', 'circle',
  'triangle', 'right-triangle', 'diamond', 'pentagon',
  'hexagon', 'octagon', 'star', 'star-4',
  'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down',
  'cross', 'heart', 'cloud', 'callout',
  'parallelogram', 'trapezoid', 'cylinder', 'document',
] as const;
/** @deprecated kept for backwards compat in validation */
export const SHAPE_TYPES = ['rectangle', 'ellipse'] as const;
export const CONNECTOR_STYLES = ['line', 'arrow'] as const;
export const TEXT_SIZES = ['small', 'medium', 'large'] as const;
export const TEMPLATE_TYPES = ['swot', 'kanban', 'retrospective', 'pros_cons', 'two_by_two'] as const;
export const PALETTE_NAMES = ['yellow', 'blue', 'green', 'pink', 'purple', 'orange', 'red', 'teal', 'gray', 'white'] as const;

export const DEFAULT_VIEWPORT_CENTER = { x: 0, y: 0 };

const CLAMP_MIN = -100000;
const CLAMP_MAX = 100000;

export interface Point {
  x: number;
  y: number;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function clampNumber(value: unknown, min: number, max: number, fallback = min): number {
  if (!isNumber(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function normalizeViewportCenter(input: unknown): Point {
  if (!input || typeof input !== 'object') return { ...DEFAULT_VIEWPORT_CENTER };
  const obj = input as Record<string, unknown>;
  return {
    x: clampNumber(obj.x, CLAMP_MIN, CLAMP_MAX, 0),
    y: clampNumber(obj.y, CLAMP_MIN, CLAMP_MAX, 0),
  };
}

export function normalizeAngle(value: unknown): number {
  const n = isNumber(value) ? value : 0;
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
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function sanitizeBatchOperations(raw: unknown): Array<{ toolName: string; args: Record<string, unknown> }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  for (const entry of raw.slice(0, 100)) {
    const op = asObject(entry);
    if (typeof op.toolName !== 'string') continue;
    out.push({
      toolName: op.toolName,
      args: asObject(op.args),
    });
  }
  return out;
}

export function validateToolArgs(toolName: string, rawArgs: unknown = {}): Record<string, unknown> {
  const args = asObject(rawArgs);

  if (toolName === 'createStickyNote') {
    return {
      text: clampText(args.text ?? '', 2000, ''),
      x: isNumber(args.x) ? clampNumber(args.x, CLAMP_MIN, CLAMP_MAX, 0) : null,
      y: isNumber(args.y) ? clampNumber(args.y, CLAMP_MIN, CLAMP_MAX, 0) : null,
      width: clampNumber(args.width, 24, 2000, 150),
      height: clampNumber(args.height, 24, 2000, 150),
      color: sanitizeColor(args.color, 'yellow'),
    };
  }

  if (toolName === 'createShape') {
    const shapeKind = (SHAPE_KINDS as readonly string[]).includes(args.shapeKind as string)
      ? args.shapeKind as string
      : (SHAPE_TYPES as readonly string[]).includes(args.type as string) ? args.type as string : 'rectangle';
    return {
      shapeKind,
      x: isNumber(args.x) ? clampNumber(args.x, CLAMP_MIN, CLAMP_MAX, 0) : null,
      y: isNumber(args.y) ? clampNumber(args.y, CLAMP_MIN, CLAMP_MAX, 0) : null,
      width: clampNumber(args.width, 24, 2000, 200),
      height: clampNumber(args.height, 24, 2000, 120),
      color: sanitizeColor(args.color, shapeKind === 'ellipse' || shapeKind === 'circle' ? 'teal' : 'blue'),
    };
  }

  if (toolName === 'createFrame') {
    return {
      title: clampText(args.title ?? 'Frame', 160, 'Frame'),
      x: isNumber(args.x) ? clampNumber(args.x, CLAMP_MIN, CLAMP_MAX, 0) : null,
      y: isNumber(args.y) ? clampNumber(args.y, CLAMP_MIN, CLAMP_MAX, 0) : null,
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
        ? { x: clampNumber(fp.x, CLAMP_MIN, CLAMP_MAX, 0), y: clampNumber(fp.y, CLAMP_MIN, CLAMP_MAX, 0) }
        : null,
      toPoint: tp && typeof tp === 'object'
        ? { x: clampNumber(tp.x, CLAMP_MIN, CLAMP_MAX, 0), y: clampNumber(tp.y, CLAMP_MIN, CLAMP_MAX, 0) }
        : null,
      style: (CONNECTOR_STYLES as readonly string[]).includes(args.style as string) ? args.style : 'arrow',
    };
  }

  if (toolName === 'createText') {
    return {
      content: clampText(args.content ?? '', 4000, ''),
      x: isNumber(args.x) ? clampNumber(args.x, CLAMP_MIN, CLAMP_MAX, 0) : null,
      y: isNumber(args.y) ? clampNumber(args.y, CLAMP_MIN, CLAMP_MAX, 0) : null,
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
      x: clampNumber(args.x, CLAMP_MIN, CLAMP_MAX, 0),
      y: clampNumber(args.y, CLAMP_MIN, CLAMP_MAX, 0),
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

  if (toolName === 'deleteObject' || toolName === 'getObjectById') {
    return {
      objectId: typeof args.objectId === 'string' ? args.objectId : null,
    };
  }

  if (toolName === 'listObjectsByType') {
    return {
      type: (OBJECT_TYPES as readonly string[]).includes(args.type as string) ? args.type : null,
      limit: clampNumber(args.limit, 1, 500, 100),
    };
  }

  if (toolName === 'getObjectsInViewport') {
    return {
      centerX: clampNumber(args.centerX, CLAMP_MIN, CLAMP_MAX, 0),
      centerY: clampNumber(args.centerY, CLAMP_MIN, CLAMP_MAX, 0),
      width: clampNumber(args.width, 1, 100000, 2000),
      height: clampNumber(args.height, 1, 100000, 1200),
      limit: clampNumber(args.limit, 1, 500, 120),
    };
  }

  if (toolName === 'createObjectsBatch' || toolName === 'updateObjectsBatch' || toolName === 'deleteObjectsBatch') {
    return {
      operations: sanitizeBatchOperations(args.operations),
    };
  }

  if (toolName === 'createStructuredTemplate') {
    const sectionTitles = Array.isArray(args.sectionTitles)
      ? args.sectionTitles.slice(0, 12).map((entry) => clampText(entry, 80, '')).filter(Boolean)
      : [];

    return {
      template: (TEMPLATE_TYPES as readonly string[]).includes(args.template as string) ? args.template : 'swot',
      title: clampText(args.title, 120, 'Template'),
      x: isNumber(args.x) ? clampNumber(args.x, CLAMP_MIN, CLAMP_MAX, 0) : null,
      y: isNumber(args.y) ? clampNumber(args.y, CLAMP_MIN, CLAMP_MAX, 0) : null,
      sectionTitles,
    };
  }

  return {};
}

let cachedToolDefinitions: ChatCompletionTool[] | null = null;

export function toToolDefinitions(): ChatCompletionTool[] {
  if (cachedToolDefinitions) return cachedToolDefinitions;

  cachedToolDefinitions = [
    {
      type: 'function',
      function: {
        name: 'createStickyNote',
        description: 'Create sticky note. Omit x/y for auto-placement.',
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
        description: 'Create a shape (rectangle, ellipse, triangle, star, arrow, etc.).',
        parameters: {
          type: 'object',
          properties: {
            shapeKind: { type: 'string', enum: [...SHAPE_KINDS] },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            color: { type: 'string', enum: [...PALETTE_NAMES] },
          },
          required: ['shapeKind'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createFrame',
        description: 'Create frame container.',
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
        description: 'Create connector between objects or points.',
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
        description: 'Create text object.',
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
        description: 'Move object to x/y.',
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
        description: 'Resize object.',
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
        description: 'Update text or sticky text.',
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
        description: 'Change color using palette token.',
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
        description: 'Set rotation angle.',
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
        description: 'Delete object by id.',
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
        description: 'Read compact board state.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getObjectById',
        description: 'Read single object by id.',
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
        name: 'listObjectsByType',
        description: 'Read objects by type with limit.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...OBJECT_TYPES] },
            limit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getObjectsInViewport',
        description: 'Read objects intersecting viewport.',
        parameters: {
          type: 'object',
          properties: {
            centerX: { type: 'number' },
            centerY: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            limit: { type: 'number' },
          },
          required: ['centerX', 'centerY', 'width', 'height'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createObjectsBatch',
        description: 'Create many objects in one call.',
        parameters: {
          type: 'object',
          properties: {
            operations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  toolName: { type: 'string', enum: ['createStickyNote', 'createShape', 'createFrame', 'createConnector', 'createText'] },
                  args: { type: 'object', additionalProperties: true },
                },
                required: ['toolName', 'args'],
                additionalProperties: false,
              },
            },
          },
          required: ['operations'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'updateObjectsBatch',
        description: 'Update many objects in one call.',
        parameters: {
          type: 'object',
          properties: {
            operations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  toolName: { type: 'string', enum: ['moveObject', 'resizeObject', 'updateText', 'changeColor', 'rotateObject'] },
                  args: { type: 'object', additionalProperties: true },
                },
                required: ['toolName', 'args'],
                additionalProperties: false,
              },
            },
          },
          required: ['operations'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'deleteObjectsBatch',
        description: 'Delete many objects in one call.',
        parameters: {
          type: 'object',
          properties: {
            operations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  toolName: { type: 'string', enum: ['deleteObject'] },
                  args: { type: 'object', additionalProperties: true },
                },
                required: ['toolName', 'args'],
                additionalProperties: false,
              },
            },
          },
          required: ['operations'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createStructuredTemplate',
        description: 'Create a structured template layout (SWOT, kanban, retrospective, pros/cons, 2x2 matrix) with titled section frames inside a parent frame.',
        parameters: {
          type: 'object',
          properties: {
            template: { type: 'string', enum: [...TEMPLATE_TYPES] },
            title: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            sectionTitles: {
              type: 'array',
              items: { type: 'string' },
              description: 'Override default section titles. If provided, determines the number of sections.',
            },
          },
          required: ['template'],
          additionalProperties: false,
        },
      },
    },
  ];

  return cachedToolDefinitions;
}
