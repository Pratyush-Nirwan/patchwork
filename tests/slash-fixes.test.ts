import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { parseSlashCommand } from "@/lib/commands/parser";
import {
  COMMAND_REGISTRY,
  findCommandDefinition,
  formatUsage,
} from "@/lib/commands/registry";
import {
  clearCommandHistory,
  loadCommandHistory,
  recordCommandHistory,
} from "@/lib/commands/history";

function createMockSessionStorage() {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

describe("Slash command fixes — unit, static, parser parity & history", () => {
  it("Item 1: records allArgSpans for positional and keyed option tokens in every position", () => {
    const newDef = findCommandDefinition("new")!;
    const p1 = parseSlashCommand('/new priority:urgent "Fix"', newDef);
    expect(p1.isCommand).toBe(true);
    if (p1.isCommand) {
      expect(p1.allArgSpans.map((s) => s.value)).toEqual(["priority:urgent", "Fix"]);
    }

    const p2 = parseSlashCommand('/new "Fix" priority:urgent label:bug', newDef);
    expect(p2.isCommand).toBe(true);
    if (p2.isCommand) {
      expect(p2.allArgSpans.map((s) => s.value)).toEqual(["Fix", "priority:urgent", "label:bug"]);
    }

    const moveDef = findCommandDefinition("move")!;
    const p3 = parseSlashCommand('/move PAY-12 "In Progress"', moveDef);
    expect(p3.isCommand).toBe(true);
    if (p3.isCommand) {
      expect(p3.allArgSpans.map((s) => s.value)).toEqual(["PAY-12", "In Progress"]);
    }
  });

  it("Item 3: CommandPalette has no separate highlightedIdx or manual data-selected", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src", "components", "CommandPalette.tsx"),
      "utf8"
    );
    expect(src).not.toMatch(/\bhighlightedIdx\b/);
    expect(src).not.toMatch(/data-selected=/);
  });

  it("Item 5: no stale ‹ › or bracketed usage patterns in registry or CommandPalette; every usage equals formatUsage(cmd)", () => {
    const registrySrc = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "commands", "registry.ts"),
      "utf8"
    );
    const paletteSrc = fs.readFileSync(
      path.join(process.cwd(), "src", "components", "CommandPalette.tsx"),
      "utf8"
    );
    expect(registrySrc).not.toMatch(/[‹›]/);
    expect(paletteSrc).not.toMatch(/[‹›]/);
    expect(paletteSrc).not.toMatch(/Usage:\s*\/[a-z]+\s*\[[^\]]+\]/);
    for (const cmd of COMMAND_REGISTRY) {
      expect(cmd.usage).toBe(formatUsage(cmd));
      expect(cmd.usage).not.toMatch(/[‹›[\]]/);
    }
  });

  it("Item 6: /new parses multi-word unquoted titles, quoted titles with literal key:, and options in any order", () => {
    const newDef = findCommandDefinition("new")!;

    const unquoted = parseSlashCommand("/new Fix login bug", newDef);
    expect(unquoted.isCommand).toBe(true);
    if (unquoted.isCommand) {
      expect(unquoted.positional).toEqual(["Fix login bug"]);
      expect(unquoted.flags).toEqual({});
    }

    const withOpts = parseSlashCommand(
      "/new Fix login bug priority:urgent assignee:me column:New",
      newDef
    );
    expect(withOpts.isCommand).toBe(true);
    if (withOpts.isCommand) {
      expect(withOpts.positional).toEqual(["Fix login bug"]);
      expect(withOpts.flags).toEqual({
        priority: "urgent",
        assignee: "me",
        column: "New",
      });
    }

    const quotedColon = parseSlashCommand('/new "Bug in priority: field" column:New', newDef);
    expect(quotedColon.isCommand).toBe(true);
    if (quotedColon.isCommand) {
      expect(quotedColon.positional).toEqual(["Bug in priority: field"]);
      expect(quotedColon.flags).toEqual({ column: "New" });
    }

    // Verify route.ts imports and uses the shared parser module
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), "src", "app", "api", "commands", "execute", "route.ts"),
      "utf8"
    );
    expect(routeSrc).toContain('from "@/lib/commands/parser"');
    expect(routeSrc).toContain("parseSlashCommand(");
  });

  it("Item 7: no 450ms timeouts remain in CommandPalette.tsx", () => {
    const paletteSrc = fs.readFileSync(
      path.join(process.cwd(), "src", "components", "CommandPalette.tsx"),
      "utf8"
    );
    expect(paletteSrc).not.toMatch(/setTimeout\s*\([^)]*450/);
  });

  describe("Item 10: recent command history", () => {
    beforeEach(() => {
      Object.defineProperty(globalThis, "window", {
        value: { sessionStorage: createMockSessionStorage() },
        configurable: true,
      });
      clearCommandHistory();
    });

    it("caps at 20 entries, deduplicates newest-first, excludes destructive and /comment, clears on logout, and revalidates role", () => {
      const moveDef = findCommandDefinition("move")!;
      const deleteDef = findCommandDefinition("delete")!;
      const archiveDef = findCommandDefinition("archive")!;
      const commentDef = findCommandDefinition("comment")!;
      const columnDef = findCommandDefinition("column")!;

      // Excludes destructive & free-text comment
      recordCommandHistory("u1", "/delete TELE-1", deleteDef);
      recordCommandHistory("u1", "/archive TELE-1", archiveDef);
      recordCommandHistory("u1", '/comment TELE-1 "secret note"', commentDef);
      expect(loadCommandHistory("u1", "admin")).toEqual([]);

      // Records allowed commands, caps at 20, deduplicates newest-first
      for (let i = 1; i <= 25; i += 1) {
        recordCommandHistory("u1", `/move TELE-${i} QA`, moveDef);
      }
      recordCommandHistory("u1", "/move TELE-5 QA", moveDef);
      const list = loadCommandHistory("u1", "member");
      expect(list).toHaveLength(20);
      expect(list[0]).toBe("/move TELE-5 QA");
      expect(list.filter((x) => x === "/move TELE-5 QA")).toHaveLength(1);

      // Role revalidation: lead-only /column excluded when recalled as member
      recordCommandHistory("u1", '/column "Blocked"', columnDef);
      expect(loadCommandHistory("u1", "lead")[0]).toBe('/column "Blocked"');
      expect(loadCommandHistory("u1", "member")).not.toContain('/column "Blocked"');

      // Account switch / logout isolation
      recordCommandHistory("u2", "/move TELE-99 Done", moveDef);
      clearCommandHistory("u1");
      expect(loadCommandHistory("u1", "admin")).toEqual([]);
      expect(loadCommandHistory("u2", "member")).toEqual(["/move TELE-99 Done"]);
      clearCommandHistory();
      expect(loadCommandHistory("u2", "member")).toEqual([]);
    });
  });
});
