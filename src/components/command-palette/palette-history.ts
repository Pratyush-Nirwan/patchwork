export interface RecentPaletteItem {
  kind: "ticket" | "board";
  id: string;
  boardId: string;
  label: string;
  sublabel?: string;
}

const RECENT_STORAGE_PREFIX = "patchwork_recent_";

export function loadRecentPaletteItems(userId: string): RecentPaletteItem[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = window.localStorage.getItem(`${RECENT_STORAGE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function recordRecentPaletteItem(userId: string, item: RecentPaletteItem): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    const existing = loadRecentPaletteItems(userId).filter(
      (r) => !(r.kind === item.kind && r.id === item.id)
    );
    const next = [item, ...existing].slice(0, 6);
    window.localStorage.setItem(`${RECENT_STORAGE_PREFIX}${userId}`, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

export function clearRecentPaletteItems(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.removeItem(`${RECENT_STORAGE_PREFIX}${userId}`);
  } catch {
    // ignore
  }
}
