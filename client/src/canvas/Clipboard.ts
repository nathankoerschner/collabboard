import type { Point } from '../types.js';
import { ObjectStore } from '../board/ObjectStore.js';

const CLIPBOARD_KEY = 'collabboard.clipboard.v1';

export function copySelection(ids: string[], objectStore: ObjectStore): void {
  if (!ids?.length) return;
  const payload = objectStore.serializeSelection(ids);
  const data = JSON.stringify({ version: 1, objects: payload, copiedAt: Date.now() });
  localStorage.setItem(CLIPBOARD_KEY, data);
}

export function pasteClipboard(objectStore: ObjectStore, viewportCenter: Point): string[] {
  const raw = localStorage.getItem(CLIPBOARD_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.objects?.length) return [];
    return objectStore.pasteSerialized(parsed.objects, { x: viewportCenter.x + 20, y: viewportCenter.y + 20 }, false);
  } catch {
    return [];
  }
}

export function duplicateSelection(ids: string[], objectStore: ObjectStore): string[] {
  if (!ids?.length) return [];
  return objectStore.duplicateSelection(ids, { x: 20, y: 20 });
}
