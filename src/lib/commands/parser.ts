import type { CommandArgSpec, CommandDefinition, CommandOptionSpec } from "./registry";

export interface CommandTokenSpan {
  value: string;
  start: number;
  end: number;
  quoted: boolean;
  closedQuote: boolean;
}

export interface ActiveOptionState {
  key: string;
  value: string;
  spec: CommandOptionSpec;
  tokenSpan: CommandTokenSpan;
}

export interface ParsedSlashCommand {
  isCommand: true;
  commandName: string;
  rawArgs: string;
  positional: string[];
  positionalSpans: CommandTokenSpan[];
  allArgSpans: CommandTokenSpan[];
  flags: Record<string, string>;
  hasTrailingSpace: boolean;
  inArgumentMode: boolean;
  activeArgIndex: number;
  activeArgToken: string;
  activeArgSpan: CommandTokenSpan | null;
  activeOption: ActiveOptionState | null;
  usedOptionKeys: string[];
  unknownKey?: { key: string; suggestion?: string; span: CommandTokenSpan };
  duplicateKeys: string[];
  overlongValue: boolean;
}

export interface SearchFilterTokens {
  inScope?: string;
  status?: string;
  priority?: "urgent" | "high" | "medium" | "low";
  assignee?: string;
  label?: string;
  due?: "overdue" | "today" | "week" | "none";
  has?: "attachments" | "links" | "comments";
  textQuery: string;
}

export interface GhostSegmentItem {
  text: string;
  required: boolean;
}

export interface SlashGhostHint {
  activeSegment: string;
  activeRequired: boolean;
  remainingSegments: string[];
  remainingItems: GhostSegmentItem[];
  readyToRun: boolean;
  needsLeadingSpace: boolean;
  needsColonGap?: boolean;
  activeArgSpec: CommandArgSpec | null;
  activeOptionSpec: CommandOptionSpec | null;
  activeArgPosition: number;
  totalArgs: number;
}

const MAX_ARG_LENGTH = 500;

export function tokenizeCommandInputWithSpans(input: string): CommandTokenSpan[] {
  const tokens: CommandTokenSpan[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let tokenStart = -1;
  let wasQuoted = false;
  let closedQuote = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (escaped) {
      if (tokenStart === -1) tokenStart = i;
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      if (tokenStart === -1) tokenStart = i;
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        closedQuote = true;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (tokenStart === -1) tokenStart = i;
      quote = ch;
      wasQuoted = true;
      closedQuote = false;
      continue;
    }
    if (/\s/.test(ch)) {
      if (tokenStart !== -1) {
        tokens.push({
          value: current,
          start: tokenStart,
          end: i,
          quoted: wasQuoted,
          closedQuote: wasQuoted ? closedQuote : true,
        });
        current = "";
        tokenStart = -1;
        wasQuoted = false;
        closedQuote = false;
      }
      continue;
    }
    if (tokenStart === -1) tokenStart = i;
    current += ch;
  }

  if (tokenStart !== -1) {
    tokens.push({
      value: current,
      start: tokenStart,
      end: input.length,
      quoted: wasQuoted,
      closedQuote: wasQuoted ? closedQuote : true,
    });
  }
  return tokens;
}

/**
 * Tokenizes a command string while respecting double and single quotes.
 */
export function tokenizeCommandInput(input: string): string[] {
  return tokenizeCommandInputWithSpans(input).map((t) => t.value);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function findClosestOption(key: string, options: CommandOptionSpec[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const opt of options) {
    const d = levenshtein(key, opt.key);
    if (d < bestDist && d <= 2) {
      bestDist = d;
      best = opt.key;
    }
  }
  return best;
}

export function parseSlashCommand(
  input: string,
  def?: CommandDefinition
): ParsedSlashCommand | { isCommand: false } {
  const leadingWs = input.length - input.trimStart().length;
  const trimmedStart = input.slice(leadingWs);
  if (!trimmedStart.startsWith("/")) {
    return { isCommand: false };
  }

  const afterSlash = trimmedStart.slice(1);
  const hasTrailingSpace = /\s$/.test(afterSlash);
  const spans = tokenizeCommandInputWithSpans(afterSlash).map((s) => ({
    ...s,
    start: s.start + leadingWs + 1,
    end: s.end + leadingWs + 1,
  }));

  const commandName = (spans[0]?.value || "").toLowerCase();
  const rest = spans.slice(1);
  const inArgumentMode = rest.length > 0 || (commandName.length > 0 && hasTrailingSpace);

  const positional: string[] = [];
  const positionalSpans: CommandTokenSpan[] = [];
  const allArgSpans: CommandTokenSpan[] = [];
  const flags: Record<string, string> = {};
  const usedOptionKeys: string[] = [];
  const duplicateKeys: string[] = [];
  const optionSpecs = def?.options || [];
  const optionMap = new Map(optionSpecs.map((o) => [o.key, o]));
  const isGreedyFirstArg = Boolean(def?.args[0]?.greedyText);
  const greedyWords: CommandTokenSpan[] = [];
  let greedyEnded = false;

  const flushGreedyTitle = () => {
    if (greedyWords.length === 0) return;
    const first = greedyWords[0];
    const last = greedyWords[greedyWords.length - 1];
    const combinedValue = input.slice(first.start, last.end).trim();
    positional.push(combinedValue);
    positionalSpans.push({
      value: combinedValue,
      start: first.start,
      end: last.end,
      quoted: false,
      closedQuote: true,
    });
    greedyWords.length = 0;
  };

  let activeOption: ActiveOptionState | null = null;
  let unknownKey: ParsedSlashCommand["unknownKey"] | undefined;
  let overlongValue = false;

  for (let i = 0; i < rest.length; i += 1) {
    const span = rest[i];
    const token = span.value;
    if (token.length > MAX_ARG_LENGTH) {
      overlongValue = true;
    }

    const isLastToken = i === rest.length - 1;

    // 1. Legacy --flag syntax
    if (token.startsWith("--") && token.length > 2) {
      flushGreedyTitle();
      greedyEnded = true;
      const eqIdx = token.indexOf("=");
      let key: string;
      let val: string;
      let combinedSpan = span;
      if (eqIdx !== -1) {
        key = token.slice(2, eqIdx).toLowerCase();
        val = token.slice(eqIdx + 1);
      } else {
        key = token.slice(2).toLowerCase();
        const next = rest[i + 1];
        if (next !== undefined && !next.value.startsWith("--")) {
          val = next.value;
          combinedSpan = {
            value: input.slice(span.start, next.end),
            start: span.start,
            end: next.end,
            quoted: false,
            closedQuote: true,
          };
          i += 1;
        } else {
          val = "true";
        }
      }
      allArgSpans.push(combinedSpan);
      if (usedOptionKeys.includes(key) && !duplicateKeys.includes(key)) {
        duplicateKeys.push(key);
      }
      usedOptionKeys.push(key);
      flags[key] = val;
      if (optionSpecs.length > 0 && !optionMap.has(key)) {
        unknownKey = { key, suggestion: findClosestOption(key, optionSpecs), span };
      }
      continue;
    }

    // 2. Discord-style key:value optional arguments (when command defines options and token is unquoted)
    const colonIdx = !span.quoted ? token.indexOf(":") : -1;
    if (colonIdx > 0 && optionSpecs.length > 0) {
      const key = token.slice(0, colonIdx).toLowerCase();
      const val = token.slice(colonIdx + 1);
      const spec = optionMap.get(key);
      if (spec) {
        flushGreedyTitle();
        greedyEnded = true;
        allArgSpans.push(span);
        if (usedOptionKeys.includes(key) && !duplicateKeys.includes(key)) {
          duplicateKeys.push(key);
        }
        usedOptionKeys.push(key);
        flags[key] = val;
        if (isLastToken && !hasTrailingSpace) {
          activeOption = { key, value: val, spec, tokenSpan: span };
        }
        continue;
      } else if (!/^[a-z]+:\/\//i.test(token)) {
        flushGreedyTitle();
        greedyEnded = true;
        allArgSpans.push(span);
        unknownKey = { key, suggestion: findClosestOption(key, optionSpecs), span };
        continue;
      }
    }

    allArgSpans.push(span);
    if (isGreedyFirstArg && !greedyEnded && positional.length === 0 && !span.quoted) {
      greedyWords.push(span);
    } else {
      flushGreedyTitle();
      if (isGreedyFirstArg && span.quoted) {
        greedyEnded = true;
      }
      positional.push(token);
      positionalSpans.push(span);
    }
  }
  flushGreedyTitle();

  const firstSpaceIdx = afterSlash.search(/\s/);
  const rawArgs = firstSpaceIdx === -1 ? "" : afterSlash.slice(firstSpaceIdx + 1).trim();

  // Determine active positional argument index
  let activeArgIndex = 0;
  let activeArgToken = "";
  let activeArgSpan: CommandTokenSpan | null = null;

  if (activeOption) {
    activeArgIndex = -1;
    activeArgToken = activeOption.value;
    activeArgSpan = activeOption.tokenSpan;
  } else if (hasTrailingSpace) {
    activeArgIndex = positional.length;
    activeArgToken = "";
    activeArgSpan = null;
  } else if (positional.length > 0) {
    activeArgIndex = positional.length - 1;
    activeArgToken = positional[activeArgIndex];
    activeArgSpan = positionalSpans[activeArgIndex];
  }

  return {
    isCommand: true,
    commandName,
    rawArgs,
    positional,
    positionalSpans,
    allArgSpans,
    flags,
    hasTrailingSpace,
    inArgumentMode,
    activeArgIndex,
    activeArgToken,
    activeArgSpan,
    activeOption,
    usedOptionKeys,
    unknownKey,
    duplicateKeys,
    overlongValue,
  };
}

export function formatArgBracket(arg: CommandArgSpec): string {
  return arg.label || arg.name;
}

export function formatOptionBracket(opt: CommandOptionSpec, includeType = false): string {
  return includeType ? `${opt.key}:${opt.typeName}` : `${opt.key}:`;
}

/**
 * Generates inline ghost hints strictly from the command's registry schema.
 */
export function buildSlashGhostHint(
  def: CommandDefinition,
  parsed: ParsedSlashCommand
): SlashGhostHint {
  const args = def.args;
  const options = def.options || [];
  const unusedOptions = options.filter((o) => !parsed.usedOptionKeys.includes(o.key));
  const requiredCount = args.filter((a) => a.required).length;

  // If user is currently typing a keyed option (e.g. `priority:` or `priority:hi`)
  if (parsed.activeOption) {
    const spec = parsed.activeOption.spec;
    const activeSegment =
      parsed.activeOption.value === "" ? spec.typeName : "";
    const remainingItems: GhostSegmentItem[] = unusedOptions.map((o) => ({
      text: formatOptionBracket(o),
      required: false,
    }));
    const remainingSegments = remainingItems.map((i) => i.text);
    const readyToRun = parsed.positional.length >= requiredCount && parsed.activeOption.value !== "";
    return {
      activeSegment,
      activeRequired: false,
      remainingSegments,
      remainingItems,
      readyToRun,
      needsLeadingSpace: false,
      needsColonGap: parsed.activeOption.value === "",
      activeArgSpec: null,
      activeOptionSpec: spec,
      activeArgPosition: parsed.positional.length,
      totalArgs: args.length,
    };
  }

  // Greedy text first argument (e.g. /new Fix login bug): once title is non-empty and no options yet,
  // suppress flag hints mid-sentence and show only `Enter to run`.
  const isGreedyTitle = Boolean(args[0]?.greedyText) && parsed.positional.length > 0;
  if (isGreedyTitle && parsed.usedOptionKeys.length === 0) {
    const readyToRun = !parsed.unknownKey;
    return {
      activeSegment: "",
      activeRequired: false,
      remainingSegments: [],
      remainingItems: [],
      readyToRun,
      needsLeadingSpace: !parsed.hasTrailingSpace && readyToRun,
      activeArgSpec: args[0] || null,
      activeOptionSpec: null,
      activeArgPosition: 1,
      totalArgs: args.length,
    };
  }

  const isTypingCurrentPositional =
    !parsed.hasTrailingSpace && parsed.positional.length > 0;
  const idx = parsed.activeArgIndex;
  const currentArg = idx >= 0 && idx < args.length ? args[idx] : null;
  const startNextIdx = isTypingCurrentPositional ? idx + 1 : idx;

  const activeSegment =
    !isTypingCurrentPositional && currentArg ? formatArgBracket(currentArg) : "";
  const activeRequired = Boolean(activeSegment && currentArg?.required);

  const remainingPositionalItems: GhostSegmentItem[] = args
    .slice(isTypingCurrentPositional ? startNextIdx : startNextIdx + (activeSegment ? 1 : 0))
    .map((a) => ({ text: formatArgBracket(a), required: Boolean(a.required) }));

  const remainingOptionItems: GhostSegmentItem[] = unusedOptions.map((o) => ({
    text: formatOptionBracket(o),
    required: false,
  }));
  const remainingItems = [...remainingPositionalItems, ...remainingOptionItems];
  const remainingSegments = remainingItems.map((i) => i.text);

  const completedCount = isTypingCurrentPositional
    ? parsed.positional.length
    : parsed.positional.length;
  const readyToRun = completedCount >= requiredCount && !parsed.unknownKey;

  return {
    activeSegment,
    activeRequired,
    remainingSegments,
    remainingItems,
    readyToRun,
    needsLeadingSpace: isTypingCurrentPositional && (remainingSegments.length > 0 || readyToRun),
    activeArgSpec: currentArg,
    activeOptionSpec: null,
    activeArgPosition: currentArg ? idx + 1 : args.length,
    totalArgs: args.length,
  };
}

export function buildCommandNameGhostHint(
  partialName: string,
  bestMatch: CommandDefinition
): { completion: string; remainingArgs: string[]; remainingItems: GhostSegmentItem[] } {
  const lower = partialName.toLowerCase();
  const completion =
    lower.length > 0 && bestMatch.name.startsWith(lower)
      ? bestMatch.name.slice(lower.length)
      : "";
  const remainingItems: GhostSegmentItem[] = [
    ...bestMatch.args.map((a) => ({ text: formatArgBracket(a), required: Boolean(a.required) })),
    ...(bestMatch.options || []).map((o) => ({ text: formatOptionBracket(o), required: false })),
  ];
  const remainingArgs = remainingItems.map((i) => i.text);
  return { completion, remainingArgs, remainingItems };
}

const VALID_PRIORITIES = new Set(["urgent", "high", "medium", "low"]);
const VALID_DUE = new Set(["overdue", "today", "week", "none"]);
const VALID_HAS = new Set(["attachments", "links", "comments"]);

export function parseSearchQuery(rawQuery: string): SearchFilterTokens {
  const tokens = tokenizeCommandInput(rawQuery.trim());
  const textParts: string[] = [];
  const filters: SearchFilterTokens = { textQuery: "" };

  for (const token of tokens) {
    const colonIdx = token.indexOf(":");
    if (colonIdx > 0) {
      const prefix = token.slice(0, colonIdx).toLowerCase();
      const value = token.slice(colonIdx + 1).trim();
      if (!value) {
        textParts.push(token);
        continue;
      }
      if (prefix === "in") {
        filters.inScope = value;
        continue;
      }
      if (prefix === "status") {
        filters.status = value;
        continue;
      }
      if (prefix === "priority" && VALID_PRIORITIES.has(value.toLowerCase())) {
        filters.priority = value.toLowerCase() as SearchFilterTokens["priority"];
        continue;
      }
      if (prefix === "assignee") {
        filters.assignee = value;
        continue;
      }
      if (prefix === "label") {
        filters.label = value;
        continue;
      }
      if (prefix === "due" && VALID_DUE.has(value.toLowerCase())) {
        filters.due = value.toLowerCase() as SearchFilterTokens["due"];
        continue;
      }
      if (prefix === "has" && VALID_HAS.has(value.toLowerCase())) {
        filters.has = value.toLowerCase() as SearchFilterTokens["has"];
        continue;
      }
    }
    textParts.push(token);
  }

  filters.textQuery = textParts.join(" ").trim();
  return filters;
}
