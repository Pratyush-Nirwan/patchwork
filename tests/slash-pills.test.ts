import { describe, expect, it } from "vitest";
import {
  COMMAND_REGISTRY,
  findCommandDefinition,
  formatUsage,
} from "../src/lib/commands/registry";
import {
  parseSlashCommand,
  serializeSlashCommand,
} from "../src/lib/commands/parser";
import { validatePillArguments } from "../src/components/command-palette/palette-validation";

describe("Slash command registry metadata, canonical parser, and pill validation", () => {
  it("every command arg and option defines argType and bracket-free label: usage", () => {
    for (const cmd of COMMAND_REGISTRY) {
      expect(cmd.usage).not.toMatch(/[‹›\[\]]/);
      expect(formatUsage(cmd)).toBe(cmd.usage);
      for (const arg of cmd.args) {
        expect(["word", "text", "choice"]).toContain(arg.argType);
        expect(cmd.usage).toContain(`${arg.label}:`);
      }
      for (const opt of cmd.options || []) {
        expect(["word", "text", "choice"]).toContain(opt.argType);
        expect(cmd.usage).toContain(`${opt.key}:`);
      }
    }
  });

  it("serializes canonical commands and quotes only when needed", () => {
    const newDef = findCommandDefinition("new")!;
    expect(
      serializeSlashCommand(newDef, ["This is the title"], { priority: "high" })
    ).toBe("/new title: This is the title priority: high");

    expect(
      serializeSlashCommand(newDef, ["Fix priority: bug"], {})
    ).toBe('/new title: "Fix priority: bug"');

    expect(
      serializeSlashCommand(newDef, [" padded "], {})
    ).toBe('/new title: " padded "');
  });

  it("parses canonical, legacy key:value, and positional forms identically", () => {
    const moveDef = findCommandDefinition("move")!;
    const canonicalMove = parseSlashCommand(
      "/move ticket: PAY-12 column: In Review",
      moveDef
    );
    const positionalMove = parseSlashCommand('/move PAY-12 "In Review"', moveDef);
    expect(canonicalMove.isCommand).toBe(true);
    expect(positionalMove.isCommand).toBe(true);
    if (canonicalMove.isCommand && positionalMove.isCommand) {
      expect(canonicalMove.positional).toEqual(["PAY-12", "In Review"]);
      expect(positionalMove.positional).toEqual(canonicalMove.positional);
    }

    const newDef = findCommandDefinition("new")!;
    const canonicalNew = parseSlashCommand(
      "/new title: Fix login priority: urgent",
      newDef
    );
    const legacyNew = parseSlashCommand(
      '/new "Fix login" priority:urgent',
      newDef
    );
    const greedyNew = parseSlashCommand(
      "/new Fix login priority:urgent",
      newDef
    );
    expect(canonicalNew.isCommand && legacyNew.isCommand && greedyNew.isCommand).toBe(true);
    if (canonicalNew.isCommand && legacyNew.isCommand && greedyNew.isCommand) {
      expect(canonicalNew.positional).toEqual(["Fix login"]);
      expect(canonicalNew.flags).toEqual({ priority: "urgent" });
      expect(legacyNew.positional).toEqual(canonicalNew.positional);
      expect(legacyNew.flags).toEqual(canonicalNew.flags);
      expect(greedyNew.positional).toEqual(canonicalNew.positional);
      expect(greedyNew.flags).toEqual(canonicalNew.flags);
    }
  });

  it("validates pill arguments without mutating unrelated pills", () => {
    const prioDef = findCommandDefinition("priority")!;
    const invalid = validatePillArguments(prioDef, [
      {
        id: "arg:key",
        kind: "positional",
        key: "key",
        label: "ticket",
        value: "INFRA-1",
        autocomplete: "ticket",
      },
      {
        id: "arg:priority",
        kind: "positional",
        key: "priority",
        label: "level",
        value: "invalid",
        autocomplete: "priority",
      },
    ]);
    expect(invalid?.pillId).toBe("arg:priority");
    expect(invalid?.message).toContain("Invalid priority");
  });
});
