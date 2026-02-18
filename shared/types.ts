// ── Object types ──────────────────────────────────────────────

export type ObjectType = 'sticky' | 'rectangle' | 'ellipse' | 'text' | 'connector' | 'frame';
export type PaletteName = 'yellow' | 'blue' | 'green' | 'pink' | 'purple' | 'orange' | 'red' | 'teal' | 'gray' | 'white';
export type ConnectorStyle = 'line' | 'arrow';
export type TextSize = 'small' | 'medium' | 'large';
export type HandleName = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type PortName = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'se' | 'sw';
export type ToolName = 'select' | 'sticky' | 'rectangle' | 'ellipse' | 'text' | 'frame' | 'connector';

// ── Geometry ─────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AABB {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Board objects ────────────────────────────────────────────

interface BoardObjectBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  createdBy: string;
  parentFrameId: string | null;
}

export interface StickyObject extends BoardObjectBase {
  type: 'sticky';
  text: string;
  color: PaletteName | string;
}

export interface RectangleObject extends BoardObjectBase {
  type: 'rectangle';
  color: PaletteName | string;
  strokeColor: PaletteName | string;
}

export interface EllipseObject extends BoardObjectBase {
  type: 'ellipse';
  color: PaletteName | string;
  strokeColor: PaletteName | string;
}

export interface TextStyle {
  bold: boolean;
  italic: boolean;
  size: TextSize;
}

export interface TextObject extends BoardObjectBase {
  type: 'text';
  content: string;
  color: PaletteName | string;
  style: TextStyle;
}

export interface ConnectorObject extends BoardObjectBase {
  type: 'connector';
  fromId: string | null;
  toId: string | null;
  fromPort: PortName | null;
  toPort: PortName | null;
  fromPoint: Point | null;
  toPoint: Point | null;
  style: ConnectorStyle;
  points: Point[];
}

export interface FrameObject extends BoardObjectBase {
  type: 'frame';
  title: string;
  color: PaletteName | string;
  children: string[];
}

export type BoardObject =
  | StickyObject
  | RectangleObject
  | EllipseObject
  | TextObject
  | ConnectorObject
  | FrameObject;

// ── Presence / cursors ───────────────────────────────────────

export interface CursorState {
  x: number;
  y: number;
}

export interface UserPresence {
  name: string;
  color: string;
}

export interface AwarenessState {
  user?: UserPresence;
  cursor?: CursorState;
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

// ── API contracts ────────────────────────────────────────────

export interface BoardRecord {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface CreateBoardRequest {
  id?: string;
  name?: string;
  userId?: string;
}

export interface AICommandRequest {
  prompt: string;
  viewportCenter?: Point;
  userId?: string;
}

export interface MutationSummary {
  createdIds: string[];
  updatedIds: string[];
  deletedIds: string[];
  toolCalls: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>;
}

export interface AICommandResponse extends MutationSummary {
  durationMs: number;
  completed: boolean;
  errors: string[];
}

// ── DB rows (server-only but co-located) ─────────────────────

export interface BoardRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface BoardSnapshotRow {
  board_id: string;
  data: Uint8Array;
  updated_at: Date;
}
