const CURSOR_PALETTE = [
  '#e74c3c', '#3498db', '#2ecc71', '#9b59b6',
  '#e67e22', '#1abc9c', '#e84393', '#00b894',
  '#fdcb6e', '#6c5ce7', '#00cec9', '#d63031',
];

function _paletteIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % CURSOR_PALETTE.length;
}

export function getPresenceColor(user: { id?: string; sub?: string; name?: string }, fallbackClientId: number): string {
  const stableSeed = user.id || user.sub || user.name;
  if (!stableSeed) return CURSOR_PALETTE[fallbackClientId % CURSOR_PALETTE.length]!;
  return CURSOR_PALETTE[_paletteIndex(stableSeed)]!;
}
