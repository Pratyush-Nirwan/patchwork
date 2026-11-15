import type { EffectiveRole } from "@/db/schema";
import { findCommandDefinition, isRoleAllowedForCommand, type CommandDefinition } from "./registry";

const HISTORY_STORAGE_PREFIX = "patchwork_cmd_history_";
const MAX_HISTORY_ENTRIES = 20;

export function shouldRecordCommandHistory(def: CommandDefinition): boolean {
  if (def.destructive || def.excludeFromHistory) return false;
  if (def.name === "comment") return false;
  return true;
}

export function loadCommandHistory(
  userId: string,
  userRole?: EffectiveRole | null
): string[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = window.sessionStorage.getItem(`${HISTORY_STORAGE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().startsWith("/"))
      .filter((entry) => {
        const cmdName = entry.trim().slice(1).split(/\s+/)[0] || "";
        const def = findCommandDefinition(cmdName);
        if (!def) return false;
        if (!shouldRecordCommandHistory(def)) return false;
        if (userRole && !isRoleAllowedForCommand(userRole, def.minRole)) return false;
        return true;
      })
      .slice(0, MAX_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

export function recordCommandHistory(
  userId: string,
  rawCommand: string,
  def: CommandDefinition
): void {
  if (typeof window === "undefined" || !userId) return;
  if (!shouldRecordCommandHistory(def)) return;
  const normalized = rawCommand.trim();
  if (!normalized.startsWith("/")) return;
  try {
    const existing = loadCommandHistory(userId).filter((item) => item !== normalized);
    const next = [normalized, ...existing].slice(0, MAX_HISTORY_ENTRIES);
    window.sessionStorage.setItem(`${HISTORY_STORAGE_PREFIX}${userId}`, JSON.stringify(next));
  } catch {
    // Ignore sessionStorage errors (private mode / quota)
  }
}

export function clearCommandHistory(userId?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (userId) {
      window.sessionStorage.removeItem(`${HISTORY_STORAGE_PREFIX}${userId}`);
      return;
    }
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(HISTORY_STORAGE_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      window.sessionStorage.removeItem(k);
    }
  } catch {
    // Ignore sessionStorage errors
  }
}

