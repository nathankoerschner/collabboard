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
];

export const OBJECT_TYPES = ['sticky', 'rectangle', 'ellipse', 'text', 'connector', 'frame'];
export const SHAPE_TYPES = ['rectangle', 'ellipse'];
export const CONNECTOR_STYLES = ['line', 'arrow'];
export const TEXT_SIZES = ['small', 'medium', 'large'];
export const PALETTE_NAMES = ['yellow', 'blue', 'green', 'pink', 'purple', 'orange', 'red', 'teal', 'gray', 'white'];

export const DEFAULT_VIEWPORT_CENTER = { x: 0, y: 0 };

export function clampNumber(value, min, max, fallback = min) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function normalizeViewportCenter(input) {
  if (!input || typeof input !== 'object') return { ...DEFAULT_VIEWPORT_CENTER };
  return {
    x: clampNumber(input.x, -100000, 100000, 0),
    y: clampNumber(input.y, -100000, 100000, 0),
  };
}

export function normalizeAngle(value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const out = ((n % 360) + 360) % 360;
  return out > 180 ? out - 360 : out;
}

export function sanitizeColor(value, fallback = 'gray') {
  if (typeof value !== 'string') return fallback;
  return PALETTE_NAMES.includes(value) ? value : fallback;
}

export function clampText(value, max = 2000, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, max);
}

function asObject(input) {
  return input && typeof input === 'object' ? input : {};
}

export function validateToolArgs(toolName, rawArgs = {}) {
  const args = asObject(rawArgs);

  if (toolName === 'createStickyNote') {
    return {
      text: clampText(args.text ?? '', 2000, ''),
      x: typeof args.x === 'number' ? clampNumber(args.x, -100000, 100000, 0) : null,
      y: typeof args.y === 'number' ? clampNumber(args.y, -100000, 100000, 0) : null,
      color: sanitizeColor(args.color, 'yellow'),
    };
  }

  if (toolName === 'createShape') {
    return {
      type: SHAPE_TYPES.includes(args.type) ? args.type : 'rectangle',
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
    return {
      fromId: typeof args.fromId === 'string' ? args.fromId : null,
      toId: typeof args.toId === 'string' ? args.toId : null,
      fromPoint: args.fromPoint && typeof args.fromPoint === 'object'
        ? { x: clampNumber(args.fromPoint.x, -100000, 100000, 0), y: clampNumber(args.fromPoint.y, -100000, 100000, 0) }
        : null,
      toPoint: args.toPoint && typeof args.toPoint === 'object'
        ? { x: clampNumber(args.toPoint.x, -100000, 100000, 0), y: clampNumber(args.toPoint.y, -100000, 100000, 0) }
        : null,
      style: CONNECTOR_STYLES.includes(args.style) ? args.style : 'arrow',
    };
  }

  if (toolName === 'createText') {
    return {
      content: clampText(args.content ?? '', 4000, ''),
      x: typeof args.x === 'number' ? clampNumber(args.x, -100000, 100000, 0) : null,
      y: typeof args.y === 'number' ? clampNumber(args.y, -100000, 100000, 0) : null,
      fontSize: TEXT_SIZES.includes(args.fontSize) ? args.fontSize : 'medium',
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

export function toToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'createStickyNote',
        description: 'Create a sticky note. Omit x/y to place near viewport center.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            color: { type: 'string', enum: PALETTE_NAMES },
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
        description: 'Create a rectangle or ellipse.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: SHAPE_TYPES },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            color: { type: 'string', enum: PALETTE_NAMES },
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
        description: 'Create a frame container.',
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
            style: { type: 'string', enum: CONNECTOR_STYLES },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'createText',
        description: 'Create a text object.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            fontSize: { type: 'string', enum: TEXT_SIZES },
            bold: { type: 'boolean' },
            italic: { type: 'boolean' },
            color: { type: 'string', enum: PALETTE_NAMES },
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
            color: { type: 'string', enum: PALETTE_NAMES },
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
