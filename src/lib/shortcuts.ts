export type ShortcutActionId =
  | "openPalette"
  | "paletteHelp"
  | "newTicket"
  | "toggleSidebar"
  | "shortcutsModal";

export interface ShortcutActionDefinition {
  id: ShortcutActionId;
  label: string;
  description: string;
  defaultCombo: string;
}

export const SHORTCUT_DEFINITIONS: ShortcutActionDefinition[] = [
  {
    id: "openPalette",
    label: "Open Command Bar",
    description: "Open the Spotlight search and slash-command bar",
    defaultCombo: "mod+k",
  },
  {
    id: "paletteHelp",
    label: "Command Bar Help",
    description: "Toggle the command reference inside the Command Bar",
    defaultCombo: "mod+/",
  },
  {
    id: "newTicket",
    label: "New Ticket",
    description: "Open the new ticket modal (outside text inputs)",
    defaultCombo: "c",
  },
  {
    id: "toggleSidebar",
    label: "Toggle Sidebar",
    description: "Show or hide the workspace navigation rail",
    defaultCombo: "[",
  },
  {
    id: "shortcutsModal",
    label: "Keyboard Shortcuts",
    description: "Open the keyboard shortcuts & preferences dialog",
    defaultCombo: "?",
  },
];

export type ShortcutMap = Record<ShortcutActionId, string>;

export function getDefaultShortcutMap(): ShortcutMap {
  return {
    openPalette: "mod+k",
    paletteHelp: "mod+/",
    newTicket: "c",
    toggleSidebar: "[",
    shortcutsModal: "?",
  };
}

/**
 * Single browser-side OS detection helper for shortcut display & modifier matching.
 * Returns false on SSR and on Windows/Linux.
 */
export function isMacBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || navigator.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function normalizeShortcutCombo(raw: string): string {
  const parts = raw
    .trim()
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return "";

  const mods = new Set<string>();
  let key = "";
  for (const part of parts) {
    if (part === "cmd" || part === "meta" || part === "ctrl" || part === "control" || part === "mod") {
      mods.add("mod");
    } else if (part === "alt" || part === "option") {
      mods.add("alt");
    } else if (part === "shift") {
      mods.add("shift");
    } else {
      key = part === "space" ? " " : part;
    }
  }

  const ordered: string[] = [];
  if (mods.has("mod")) ordered.push("mod");
  if (mods.has("alt")) ordered.push("alt");
  if (mods.has("shift")) ordered.push("shift");
  if (key) ordered.push(key);
  return ordered.join("+");
}

export function formatShortcut(combo: string, isMac = isMacBrowser()): string {
  const normalized = normalizeShortcutCombo(combo);
  if (!normalized) return "";
  const parts = normalized.split("+");
  const formatted = parts.map((part) => {
    if (part === "mod") return isMac ? "⌘" : "Ctrl";
    if (part === "alt") return isMac ? "⌥" : "Alt";
    if (part === "shift") return isMac ? "⇧" : "Shift";
    if (part === " ") return "Space";
    if (part.length === 1) return part.toUpperCase();
    return part.charAt(0).toUpperCase() + part.slice(1);
  });
  return isMac ? formatted.join("") : formatted.join("+");
}

export function eventToShortcutCombo(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): string {
  const rawKey = e.key;
  if (!rawKey) return "";
  const lower = rawKey.toLowerCase();
  if (["control", "meta", "shift", "alt", "os"].includes(lower)) {
    return "";
  }

  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  // Preserve shifted punctuation like '?' cleanly without adding redundant shift+
  const isShiftedSymbol = e.shiftKey && rawKey.length === 1 && !/[a-zA-Z0-9]/.test(rawKey);
  if (e.shiftKey && !isShiftedSymbol) parts.push("shift");
  parts.push(lower);
  return normalizeShortcutCombo(parts.join("+"));
}

export function matchesShortcut(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  combo: string
): boolean {
  const target = normalizeShortcutCombo(combo);
  if (!target) return false;

  const parts = target.split("+");
  const key = parts[parts.length - 1];
  const needsMod = parts.includes("mod");
  const needsAlt = parts.includes("alt");
  const needsShift = parts.includes("shift");

  const hasMod = Boolean(e.metaKey || e.ctrlKey);
  if (hasMod !== needsMod) return false;
  if (Boolean(e.altKey) !== needsAlt) return false;

  const pressedKey = (e.key || "").toLowerCase();
  if (pressedKey !== key) return false;

  const isShiftedSymbol = e.shiftKey && (e.key || "").length === 1 && !/[a-zA-Z0-9]/.test(e.key || "");
  if (!isShiftedSymbol && Boolean(e.shiftKey) !== needsShift) return false;

  return true;
}

export function detectShortcutConflict(
  actionId: ShortcutActionId,
  candidateCombo: string,
  currentMap: ShortcutMap
): ShortcutActionId | null {
  const normalized = normalizeShortcutCombo(candidateCombo);
  if (!normalized) return null;

  for (const [otherId, otherCombo] of Object.entries(currentMap) as [ShortcutActionId, string][]) {
    if (otherId === actionId) continue;
    if (normalizeShortcutCombo(otherCombo) === normalized) {
      return otherId;
    }
  }
  return null;
}

const STORAGE_PREFIX = "patchwork_shortcuts_";

export function loadUserShortcuts(userId: string): ShortcutMap {
  const defaults = getDefaultShortcutMap();
  if (typeof window === "undefined" || !userId) return defaults;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ShortcutMap>;
    const merged = { ...defaults };
    for (const def of SHORTCUT_DEFINITIONS) {
      const val = parsed[def.id];
      if (typeof val === "string" && normalizeShortcutCombo(val)) {
        merged[def.id] = normalizeShortcutCombo(val);
      }
    }
    return merged;
  } catch {
    return defaults;
  }
}

export function saveUserShortcuts(userId: string, map: ShortcutMap): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

export function resetUserShortcuts(userId: string): ShortcutMap {
  const defaults = getDefaultShortcutMap();
  if (typeof window !== "undefined" && userId) {
    try {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${userId}`);
    } catch {
      // ignore
    }
  }
  return defaults;
}

