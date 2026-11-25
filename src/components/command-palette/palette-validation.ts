import type { CommandDefinition } from "@/lib/commands/registry";
import type { ParsedSlashCommand } from "@/lib/commands/parser";

export interface PillValidationTarget {
  id: string;
  kind: "positional" | "option";
  key: string;
  label: string;
  value: string;
  autocomplete: string;
}

export function validateActiveArgument(
  def: CommandDefinition,
  parsed: ParsedSlashCommand
): { message: string; span?: { start: number; end: number } | null } | null {
  if (parsed.overlongValue) {
    return { message: "Argument value exceeds maximum length (500 characters).", span: parsed.activeArgSpan };
  }
  if (parsed.unknownKey) {
    const sug = parsed.unknownKey.suggestion
      ? ` Did you mean '${parsed.unknownKey.suggestion}'?`
      : "";
    return {
      message: `Unknown option '${parsed.unknownKey.key}'.${sug}`,
      span: parsed.unknownKey.span,
    };
  }
  if (parsed.duplicateKeys.length > 0) {
    return {
      message: `Duplicate option '${parsed.duplicateKeys[0]}'.`,
      span: parsed.activeArgSpan,
    };
  }

  // Validate closed/complete priority, view, or theme token
  if (parsed.activeOption && parsed.activeOption.key === "priority" && parsed.activeOption.value) {
    const v = parsed.activeOption.value.toLowerCase();
    const valid = ["urgent", "high", "medium", "low"];
    if (!valid.some((p) => p.startsWith(v))) {
      return {
        message: `Invalid priority '${parsed.activeOption.value}'. Use urgent, high, medium, or low.`,
        span: parsed.activeOption.tokenSpan,
      };
    }
  }

  if (
    !parsed.activeOption &&
    parsed.activeArgIndex >= 0 &&
    parsed.activeArgIndex < def.args.length &&
    parsed.activeArgToken
  ) {
    const spec = def.args[parsed.activeArgIndex];
    const tok = parsed.activeArgToken.toLowerCase();
    if (spec.autocomplete === "priority" && !["urgent", "high", "medium", "low"].some((p) => p.startsWith(tok))) {
      return {
        message: `Invalid priority '${parsed.activeArgToken}'. Use urgent, high, medium, or low.`,
        span: parsed.activeArgSpan,
      };
    }
    if (spec.autocomplete === "view" && !["kanban", "calendar"].some((v) => v.startsWith(tok))) {
      return {
        message: `Invalid view '${parsed.activeArgToken}'. Use kanban or calendar.`,
        span: parsed.activeArgSpan,
      };
    }
    if (spec.autocomplete === "theme" && !["dark", "light", "toggle"].some((t) => t.startsWith(tok))) {
      return {
        message: `Invalid theme '${parsed.activeArgToken}'. Use dark, light, or toggle.`,
        span: parsed.activeArgSpan,
      };
    }
  }

  return null;
}

export function validatePillArguments(
  _def: CommandDefinition,
  pills: PillValidationTarget[]
): { message: string; pillId: string } | null {
  for (const pill of pills) {
    const val = pill.value.trim();
    if (!val) continue;
    if (val.length > 500) {
      return {
        message: "Argument value exceeds maximum length (500 characters).",
        pillId: pill.id,
      };
    }
    const lower = val.toLowerCase();
    if (pill.autocomplete === "priority" && !["urgent", "high", "medium", "low"].some((p) => p.startsWith(lower))) {
      return {
        message: `Invalid priority '${val}'. Use urgent, high, medium, or low.`,
        pillId: pill.id,
      };
    }
    if (pill.autocomplete === "view" && !["kanban", "calendar"].some((v) => v.startsWith(lower))) {
      return {
        message: `Invalid view '${val}'. Use kanban or calendar.`,
        pillId: pill.id,
      };
    }
    if (pill.autocomplete === "theme" && !["dark", "light", "toggle"].some((t) => t.startsWith(lower))) {
      return {
        message: `Invalid theme '${val}'. Use dark, light, or toggle.`,
        pillId: pill.id,
      };
    }
  }
  return null;
}
