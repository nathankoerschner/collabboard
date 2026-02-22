import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BoardToolRunner } from './boardTools.js';

export const AI_TOOL_NAMES = [
  'createStickyNote',
  'createShape',
  'createFrame',
  'createConnector',
  'createText',
  'createTable',
  'moveObject',
  'arrangeObjectsInGrid',
  'resizeObject',
  'updateText',
  'changeColor',
  'rotateObject',
  'deleteObject',
  'getBoardState',
] as const;

export const OBJECT_TYPES = ['sticky', 'rectangle', 'ellipse', 'text', 'connector', 'frame', 'table'] as const;
export const SHAPE_TYPES = ['rectangle', 'ellipse'] as const;
export const CONNECTOR_STYLES = ['line', 'arrow'] as const;
export const TEXT_SIZES = ['small', 'medium', 'large'] as const;
export const STICKY_COLORS = ['yellow', 'blue', 'green', 'pink', 'purple', 'orange', 'red', 'teal'] as const;
export const PALETTE_NAMES = [...STICKY_COLORS, 'black'] as const;

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

export function sanitizeColor(value: unknown, fallback = 'black'): string {
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

// Coordinate helper: clamp if number, null otherwise
function coordOrNull(v: unknown): number | null {
  return typeof v === 'number' ? clampNumber(v, -100000, 100000, 0) : null;
}
function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

// Post-processing rules per tool: apply clamping, defaults, sanitization
const toolPostProcess: Record<string, (a: Record<string, unknown>) => Record<string, unknown>> = {
  createStickyNote: (a) => ({
    text: clampText(a.text ?? '', 2000, ''),
    x: coordOrNull(a.x), y: coordOrNull(a.y),
    width: clampNumber(a.width, 24, 2000, 150),
    height: clampNumber(a.height, 24, 2000, 150),
    color: sanitizeColor(a.color, 'yellow'),
  }),
  createShape: (a) => ({
    type: (SHAPE_TYPES as readonly string[]).includes(a.type as string) ? a.type : 'rectangle',
    x: coordOrNull(a.x), y: coordOrNull(a.y),
    width: clampNumber(a.width, 24, 2000, 200),
    height: clampNumber(a.height, 24, 2000, 120),
    color: sanitizeColor(a.color, a.type === 'ellipse' ? 'teal' : 'blue'),
  }),
  createFrame: (a) => ({
    title: clampText(a.title ?? 'Frame', 160, 'Frame'),
    x: coordOrNull(a.x), y: coordOrNull(a.y),
    width: clampNumber(a.width, 120, 4000, 360),
    height: clampNumber(a.height, 120, 4000, 240),
  }),
  createConnector: (a) => {
    const fp = a.fromPoint as Record<string, unknown> | null;
    const tp = a.toPoint as Record<string, unknown> | null;
    return {
      fromId: stringOrNull(a.fromId), toId: stringOrNull(a.toId),
      fromPoint: fp && typeof fp === 'object' ? { x: clampNumber(fp.x, -100000, 100000, 0), y: clampNumber(fp.y, -100000, 100000, 0) } : null,
      toPoint: tp && typeof tp === 'object' ? { x: clampNumber(tp.x, -100000, 100000, 0), y: clampNumber(tp.y, -100000, 100000, 0) } : null,
      fromT: typeof a.fromT === 'number' ? Math.max(0, Math.min(1, a.fromT)) : null,
      toT: typeof a.toT === 'number' ? Math.max(0, Math.min(1, a.toT)) : null,
      style: (CONNECTOR_STYLES as readonly string[]).includes(a.style as string) ? a.style : 'arrow',
    };
  },
  createTable: (a) => {
    const headers = Array.isArray(a.headers)
      ? a.headers.filter((h): h is string => typeof h === 'string').slice(0, 20).map((h) => h.slice(0, 200))
      : [];
    const data = Array.isArray(a.data)
      ? a.data.slice(0, 100).map((row: unknown) =>
          Array.isArray(row) ? row.slice(0, 20).map((c: unknown) => clampText(c, 500, '')) : []
        )
      : [];
    const numCols = headers.length || clampNumber(a.numColumns, 1, 20, 3);
    const numRows = data.length || clampNumber(a.numRows, 1, 100, 3);
    return {
      title: clampText(a.title ?? 'Table', 200, 'Table'),
      headers,
      data,
      numColumns: numCols,
      numRows: numRows,
      x: coordOrNull(a.x), y: coordOrNull(a.y),
      color: typeof a.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(a.color) ? a.color : '#e2e8f0',
    };
  },
  createText: (a) => ({
    content: clampText(a.content ?? '', 4000, ''),
    x: coordOrNull(a.x), y: coordOrNull(a.y),
    width: clampNumber(a.width, 24, 2000, 220),
    height: clampNumber(a.height, 24, 2000, 60),
    fontSize: (TEXT_SIZES as readonly string[]).includes(a.fontSize as string) ? a.fontSize : 'medium',
    bold: Boolean(a.bold), italic: Boolean(a.italic),
    color: sanitizeColor(a.color, 'black'),
  }),
  moveObject: (a) => ({
    objectId: stringOrNull(a.objectId),
    x: clampNumber(a.x, -100000, 100000, 0),
    y: clampNumber(a.y, -100000, 100000, 0),
  }),
  resizeObject: (a) => ({
    objectId: stringOrNull(a.objectId),
    width: clampNumber(a.width, 24, 4000, 120),
    height: clampNumber(a.height, 24, 4000, 80),
  }),
  arrangeObjectsInGrid: (a) => ({
    objectIds: Array.isArray(a.objectIds)
      ? a.objectIds.filter((id): id is string => typeof id === 'string').slice(0, 500) : [],
    columns: typeof a.columns === 'number' ? clampNumber(a.columns, 1, 24, 3) : null,
    gapX: clampNumber(a.gapX, 0, 1000, 24),
    gapY: clampNumber(a.gapY, 0, 1000, 24),
    originX: typeof a.originX === 'number' ? clampNumber(a.originX, -100000, 100000, 0) : null,
    originY: typeof a.originY === 'number' ? clampNumber(a.originY, -100000, 100000, 0) : null,
  }),
  updateText: (a) => ({
    objectId: stringOrNull(a.objectId),
    newText: clampText(a.newText ?? '', 4000, ''),
  }),
  changeColor: (a) => ({
    objectId: stringOrNull(a.objectId),
    color: sanitizeColor(a.color, 'black'),
  }),
  rotateObject: (a) => ({
    objectId: stringOrNull(a.objectId),
    angleDegrees: normalizeAngle(a.angleDegrees),
  }),
  deleteObject: (a) => ({
    objectId: stringOrNull(a.objectId),
  }),
};

export function validateToolArgs(toolName: string, rawArgs: unknown = {}): Record<string, unknown> {
  const args = asObject(rawArgs);
  const postProcess = toolPostProcess[toolName];
  if (!postProcess) return {};
  return postProcess(args);
}

const paletteEnum = z.enum([...PALETTE_NAMES] as [string, ...string[]]);

export const langChainSchemas: Record<string, { description: string; schema: z.ZodObject<z.ZodRawShape> }> = {
  createStickyNote: {
    description: 'Create a sticky note. Default size is 150x150. Omit x/y to place near viewport center. When placing inside a frame, set x/y within the frame bounds so it becomes a child of that frame.',
    schema: z.object({
      text: z.string().describe('Sticky note text'),
      x: z.number().nullish().describe('X coordinate'),
      y: z.number().nullish().describe('Y coordinate'),
      width: z.number().nullish().describe('Width'),
      height: z.number().nullish().describe('Height'),
      color: paletteEnum.optional().describe('Sticky color (yellow, blue, green, pink, purple, orange, red, teal)'),
    }),
  },
  createShape: {
    description: 'Create a rectangle or ellipse. Default size is 200x120.',
    schema: z.object({
      type: z.enum([...SHAPE_TYPES] as [string, ...string[]]).describe('Shape type'),
      x: z.number().nullish().describe('X coordinate'),
      y: z.number().nullish().describe('Y coordinate'),
      width: z.number().nullish().describe('Width'),
      height: z.number().nullish().describe('Height'),
      color: paletteEnum.optional().describe('Color'),
    }),
  },
  createFrame: {
    description: 'Create a labeled section container. Use frames for categories/quadrants/columns where users will later add stickies. Width/height are the ACTUAL frame dimensions (outer bounds). Frame title bar height is 32px and should remain reserved for title/selection behavior. Deterministic sticky-fit sizing: size section frames to fit 6 default stickies in a 3x2 grid with fixed 24px gaps. With 150x150 stickies, required note area is 498x324 (3*150 + 2*24 by 2*150 + 24). Add fixed 24px inner padding on all sides of that note area and keep it below the title bar, so minimum ACTUAL section frame size is 546x404. For placement/containment, always use ACTUAL frame dimensions (not usable dimensions). Keep sibling spacing deterministic with fixed 24px gaps, fixed 24px parent padding, and left-to-right then top-to-bottom placement. For N equal columns use columnWidth = floor((parentUsableWidth - (N - 1) * 24) / N). Outside-frame wrap rule: include ALL generated section-fill frames when computing outer bounds. Account for the top title bar by reserving (32 + 24) at the top of inner content, then compute deterministic outer bounds from inner extents: left = minInnerX - 24, top = minInnerY - (32 + 24), right = maxInnerRight + 24, bottom = maxInnerBottom + 24.',
    schema: z.object({
      title: z.string().optional().describe('Frame title'),
      x: z.number().nullish().describe('X coordinate'),
      y: z.number().nullish().describe('Y coordinate'),
      width: z.number().nullish().describe('Width'),
      height: z.number().nullish().describe('Height'),
    }),
  },
  createConnector: {
    description: 'Create connector between objects or points. Connectors have a default size of 0x0. Use fromT/toT (0-1) to attach at a specific perimeter position.',
    schema: z.object({
      fromId: z.string().optional().describe('Source object ID'),
      toId: z.string().optional().describe('Target object ID'),
      fromPoint: z.object({ x: z.number(), y: z.number() }).optional().describe('Source point'),
      toPoint: z.object({ x: z.number(), y: z.number() }).optional().describe('Target point'),
      fromT: z.number().min(0).max(1).optional().describe('Perimeter position 0-1 on source object'),
      toT: z.number().min(0).max(1).optional().describe('Perimeter position 0-1 on target object'),
      style: z.enum([...CONNECTOR_STYLES] as [string, ...string[]]).optional().describe('Connector style'),
    }),
  },
  createText: {
    description: 'Create a text object. Default size is 220x60.',
    schema: z.object({
      content: z.string().describe('Text content'),
      x: z.number().nullish().describe('X coordinate'),
      y: z.number().nullish().describe('Y coordinate'),
      width: z.number().nullish().describe('Width'),
      height: z.number().nullish().describe('Height'),
      fontSize: z.enum([...TEXT_SIZES] as [string, ...string[]]).optional().describe('Font size'),
      bold: z.boolean().optional().describe('Bold'),
      italic: z.boolean().optional().describe('Italic'),
      color: paletteEnum.optional().describe('Color'),
    }),
  },
  createTable: {
    description: 'Create a table with rows and columns. Provide headers for column names and data as a 2D array for cell content. Default is 3 columns x 3 rows. Default column width is 120px, row height is 32px.',
    schema: z.object({
      title: z.string().optional().describe('Table title'),
      headers: z.array(z.string()).optional().describe('Column header names (populate first row)'),
      data: z.array(z.array(z.string())).optional().describe('2D array of cell data, each inner array is a row of values'),
      numColumns: z.number().optional().describe('Number of columns (ignored if headers provided)'),
      numRows: z.number().optional().describe('Number of rows (ignored if data provided)'),
      x: z.number().nullish().describe('X coordinate'),
      y: z.number().nullish().describe('Y coordinate'),
      color: z.string().optional().describe('Table color as hex string (default #e2e8f0)'),
    }),
  },
  moveObject: {
    description: 'Move an object to absolute x/y world coordinates.',
    schema: z.object({
      objectId: z.string().describe('Object ID'),
      x: z.number().describe('X coordinate'),
      y: z.number().describe('Y coordinate'),
    }),
  },
  arrangeObjectsInGrid: {
    description: 'Arrange existing objects into a deterministic grid. Use this for selected notes/items.',
    schema: z.object({
      objectIds: z.array(z.string()).describe('Object IDs to arrange'),
      columns: z.number().optional().describe('Optional fixed column count'),
      gapX: z.number().optional().describe('Horizontal gap in px'),
      gapY: z.number().optional().describe('Vertical gap in px'),
      originX: z.number().optional().describe('Optional grid origin x'),
      originY: z.number().optional().describe('Optional grid origin y'),
    }),
  },
  resizeObject: {
    description: 'Resize an object; keeps top-left anchored.',
    schema: z.object({
      objectId: z.string().describe('Object ID'),
      width: z.number().describe('Width'),
      height: z.number().describe('Height'),
    }),
  },
  updateText: {
    description: 'Update text content on a sticky or text object.',
    schema: z.object({
      objectId: z.string().describe('Object ID'),
      newText: z.string().describe('New text content'),
    }),
  },
  changeColor: {
    description: 'Update object color using palette token.',
    schema: z.object({
      objectId: z.string().describe('Object ID'),
      color: paletteEnum.describe('New color'),
    }),
  },
  rotateObject: {
    description: 'Rotate object by setting angle in degrees.',
    schema: z.object({
      objectId: z.string().describe('Object ID'),
      angleDegrees: z.number().describe('Angle in degrees'),
    }),
  },
  deleteObject: {
    description: 'Delete an object by id.',
    schema: z.object({
      objectId: z.string().describe('Object ID'),
    }),
  },
  getBoardState: {
    description: 'Read compact board state for planning tool calls.',
    schema: z.object({}),
  },
};

export function toLangChainTools(runner: BoardToolRunner): DynamicStructuredTool[] {
  return AI_TOOL_NAMES.map((toolName) => {
    const def = langChainSchemas[toolName];
    if (!def) throw new Error(`Missing LangChain schema for tool: ${toolName}`);
    return new DynamicStructuredTool({
      name: toolName,
      description: def.description,
      schema: def.schema,
      func: async (args: Record<string, unknown>) => {
        const result = runner.invoke(toolName, args);
        return JSON.stringify(result);
      },
    });
  });
}
