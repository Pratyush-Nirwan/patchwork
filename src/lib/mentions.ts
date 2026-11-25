import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orgMembers, teamMembers, users } from "@/db/schema";
import type { DbOrTx } from "./domain-events";

const MENTION_TOKEN_RE = /@\[([^\]]{1,120})\]\(mention:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

/**
 * Strips fenced code blocks, inline code spans, and blockquote lines before parsing mentions.
 */
export function stripNonMentionMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const kept: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (line.trimStart().startsWith(">")) continue;
    // Strip inline code spans `...`
    kept.push(line.replace(/`[^`]*`/g, " "));
  }
  return kept.join("\n");
}

/**
 * Extracts unique candidate user UUIDs from mention tokens outside code blocks/inline code/quotes.
 */
export function extractMentionUserIds(markdown: string): string[] {
  if (!markdown) return [];
  const scannable = stripNonMentionMarkdown(markdown);
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(MENTION_TOKEN_RE.source, "g");
  while ((match = re.exec(scannable)) !== null) {
    ids.add(match[2].toLowerCase());
  }
  return [...ids];
}

/**
 * Verifies every mentioned user exists, is active, and has view access to the ticket's team/org.
 * Strips invalid/unauthorized mention tokens to plain `@Name` so forged IDs cannot persist or leak.
 */
export async function validateAndSanitizeMentions(
  markdown: string,
  scope: { orgId: string; teamId: string },
  tx: DbOrTx = db
): Promise<{
  validUserIds: string[];
  unauthorizedCount: number;
  sanitizedMarkdown: string;
}> {
  const candidateIds = extractMentionUserIds(markdown);
  if (candidateIds.length === 0) {
    return { validUserIds: [], unauthorizedCount: 0, sanitizedMarkdown: markdown };
  }

  const activeUsers = await tx
    .select({ id: users.id, name: users.name, isDeactivated: users.isDeactivated })
    .from(users)
    .where(inArray(users.id, candidateIds));

  const orgAdmins = await tx
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, scope.orgId),
        eq(orgMembers.role, "admin"),
        inArray(orgMembers.userId, candidateIds)
      )
    );
  const adminSet = new Set(orgAdmins.map((r) => r.userId.toLowerCase()));

  const teamMems = await tx
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, scope.teamId),
        inArray(teamMembers.userId, candidateIds)
      )
    );
  const teamSet = new Set(teamMems.map((r) => r.userId.toLowerCase()));

  const validMap = new Map<string, string>();
  for (const u of activeUsers) {
    const idLower = u.id.toLowerCase();
    if (!u.isDeactivated && (adminSet.has(idLower) || teamSet.has(idLower))) {
      validMap.set(idLower, u.name);
    }
  }

  const unauthorizedSet = new Set<string>();
  const validFound = new Set<string>();

  // Sanitize outside code blocks/quotes only
  const lines = markdown.split(/\r?\n/);
  let inCodeBlock = false;
  const outLines = lines.map((line) => {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      return line;
    }
    if (inCodeBlock || line.trimStart().startsWith(">")) {
      return line;
    }
    // Split by inline code so we never touch inside `...`
    const parts = line.split(/(`[^`]*`)/g);
    return parts
      .map((part) => {
        if (part.startsWith("`") && part.endsWith("`")) return part;
        return part.replace(
          new RegExp(MENTION_TOKEN_RE.source, "g"),
          (_full, label: string, rawId: string) => {
            const idLower = rawId.toLowerCase();
            const resolvedName = validMap.get(idLower);
            if (!resolvedName) {
              unauthorizedSet.add(idLower);
              return `@${label}`;
            }
            validFound.add(idLower);
            return `@[${resolvedName}](mention:${idLower})`;
          }
        );
      })
      .join("");
  });

  return {
    validUserIds: [...validFound],
    unauthorizedCount: unauthorizedSet.size,
    sanitizedMarkdown: outLines.join("\n"),
  };
}

/**
 * Lists active users who can view a ticket (for the @mention picker).
 * Returns id and name only.
 */
export async function listMentionableUsers(
  scope: { orgId: string; teamId: string },
  query?: string
): Promise<Array<{ id: string; name: string }>> {
  const [adminRows, teamRows] = await Promise.all([
    db
      .select({ id: users.id, name: users.name })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(
        and(
          eq(orgMembers.orgId, scope.orgId),
          eq(orgMembers.role, "admin"),
          eq(users.isDeactivated, false)
        )
      ),
    db
      .select({ id: users.id, name: users.name })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(and(eq(teamMembers.teamId, scope.teamId), eq(users.isDeactivated, false)))
      .orderBy(asc(users.name)),
  ]);

  const byId = new Map<string, { id: string; name: string }>();
  for (const r of [...adminRows, ...teamRows]) {
    if (!byId.has(r.id)) byId.set(r.id, r);
  }

  const all = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  const q = query?.trim().toLowerCase();
  if (!q) return all;
  return all.filter((u) => u.name.toLowerCase().includes(q));
}

/**
 * Strips mention token syntax to plain `@Name` for snippets/plain-text emails.
 */
export function mentionsToPlainText(markdown: string): string {
  return markdown.replace(
    new RegExp(MENTION_TOKEN_RE.source, "g"),
    (_full, label: string) => `@${label}`
  );
}
