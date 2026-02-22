// ── Shared Board Object Types ──

export type StickyColor = 'yellow' | 'blue' | 'green' | 'pink' | 'purple' | 'orange' | 'red' | 'teal' | 'gray' | 'white';

export type ShapeKind =
  | 'rectangle' | 'rounded-rectangle' | 'ellipse' | 'circle'
  | 'triangle' | 'right-triangle' | 'diamond' | 'pentagon'
  | 'hexagon' | 'octagon' | 'star' | 'star-4'
  | 'arrow-right' | 'arrow-left' | 'arrow-up' | 'arrow-down'
  | 'cross' | 'heart' | 'cloud' | 'callout'
  | 'parallelogram' | 'trapezoid' | 'cylinder' | 'document';

export type ObjectType = 'sticky' | 'rectangle' | 'ellipse' | 'text' | 'connector' | 'frame' | 'shape' | 'table';
export type ConnectorStyle = 'line' | 'arrow';
export type TextSize = 'small' | 'medium' | 'large';
export type PortName = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'se' | 'sw';
export type HandleName = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type ToolName = 'select' | 'sticky' | 'rectangle' | 'ellipse' | 'text' | 'frame' | 'shape' | 'table';

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BaseObject {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  createdBy: string;
  parentFrameId: string | null;
}

export interface StickyNote extends BaseObject {
  type: 'sticky';
  text: string;
  color: string;
}

export interface RectangleObject extends BaseObject {
  type: 'rectangle';
  color: string;
  strokeColor: string;
}

export interface EllipseObject extends BaseObject {
  type: 'ellipse';
  color: string;
  strokeColor: string;
}

export interface TextObject extends BaseObject {
  type: 'text';
  content: string;
  color: string;
  style: TextStyle;
}

export interface TextStyle {
  bold: boolean;
  italic: boolean;
  size: TextSize;
}

export interface Connector extends BaseObject {
  type: 'connector';
  fromId: string | null;
  toId: string | null;
  fromPort: string | null;
  toPort: string | null;
  fromPoint: Point | null;
  toPoint: Point | null;
  fromT: number | null;
  toT: number | null;
  style: ConnectorStyle | string;
  points: Point[] | string[];
}

export interface Frame extends BaseObject {
  type: 'frame';
  title: string;
  color: string;
  children: string[];
}

export interface ShapeObject extends BaseObject {
  type: 'shape';
  shapeKind: ShapeKind;
  color: string;
  strokeColor: string;
}

export interface TableObject extends BaseObject {
  type: 'table';
  title: string;
  columns: string[];
  rows: string[];
  columnWidths: Record<string, number>;
  rowHeights: Record<string, number>;
  cells: Record<string, string>;
  color: string;
}

export type BoardObject = StickyNote | RectangleObject | EllipseObject | TextObject | Connector | Frame | ShapeObject | TableObject;

// ── Port ──

export interface Port {
  name: string;
  x: number;
  y: number;
}

// ── Hit Test Results ──

export type FrameHitArea = 'title' | 'border' | 'inside';

export interface HitTestResult {
  object: BoardObject;
  area: string;
}

// ── Reveal Animation ──

export interface RevealState {
  alpha: number;
  scale: number;
}

export interface RevealEntry {
  startAt: number;
  durationMs: number;
}

// ── Cursor ──

export interface CursorData {
  x: number;
  y: number;
  name: string;
  color: string;
  clientId: number;
}

export interface RemoteCursor {
  targetX: number;
  targetY: number;
  currentX: number;
  currentY: number;
  name: string;
  color: string;
  lastUpdate: number;
}

// ── Connector Endpoint Payload ──

export interface ConnectorAttachPayload {
  objectId: string;
  port: string;
}

export interface ConnectorTAttachPayload {
  objectId: string;
  t: number;
}

export interface ConnectorPointPayload {
  point: Point;
}

export type ConnectorEndpointPayload = ConnectorAttachPayload | ConnectorTAttachPayload | ConnectorPointPayload;

// ── Attach Result ──

export interface AttachResult {
  object: BoardObject;
  t: number;
  port?: string;
}

// ── Callback Interfaces ──

export interface CanvasCallbacks {
  onToolChange?: (tool: ToolName) => void;
  onSelectionChange?: (ids: string[]) => void;
}

export interface InputHandlerCallbacks {
  onSelectionChange?: (ids: string[]) => void;
  onMoveSelection?: (ids: string[], dx: number, dy: number) => void;
  onResizeObject?: (id: string, x: number, y: number, w: number, h: number) => void;
  onRotateSelection?: (ids: string[], delta: number, pivot: Point) => void;
  onCreate?: (type: ObjectType, x: number, y: number, w: number, h: number, extra?: Record<string, unknown>) => BoardObject | undefined;
  onDeleteSelection?: (ids: string[]) => void;
  onCopySelection?: (ids: string[]) => void;
  onPaste?: () => void;
  onDuplicateSelection?: (ids: string[]) => void;
  onToolAutoReset?: (tool: ToolName) => void;
  onEditObject?: (id: string) => void;
  onBringToFront?: (id: string) => void;
  onCursorMove?: (wx: number, wy: number) => void;
  onStartConnector?: (wx: number, wy: number, attach?: { objectId: string; t: number } | { objectId: string; port: string }) => BoardObject | undefined;
  onResolveAttach?: (wx: number, wy: number, connectorId: string, excludeSourceId?: string | null) => AttachResult | null;
  onConnectorEndpoint?: (id: string, side: string, payload: ConnectorEndpointPayload) => void;
  onFinishConnector?: (id: string) => void;
  onGestureEnd?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export interface TextEditorCallbacks {
  onTextChange?: (id: string, text: string) => void;
  onTextStyleChange?: (id: string, patch: Partial<TextStyle>) => void;
  onResize?: (id: string, width: number, height: number) => void;
  onEditEnd?: () => void;
}

// ── Palette ──

export type Palette = Record<string, string>;
