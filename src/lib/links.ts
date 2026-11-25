import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ticketLinks } from "@/db/schema";
import { requireTicketRole } from "./rbac";
import { AppError, NotFoundError } from "./errors";
import { recordActivity } from "./tickets";
import { realtimeHub } from "./realtime";
import { getSystemSetting, decryptIntegrationToken } from "./settings";
import { emitDomainEvent, notifyDomainEventWorker } from "./domain-events";

export interface ParsedForgeUrl {
  provider: "github" | "gitlab";
  kind: "pr" | "mr" | "issue" | "commit";
  ownerRepo: string;
  identifier: string;
  externalRef: string;
}

export function parseForgeUrl(rawUrl: string): ParsedForgeUrl {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new AppError("Invalid URL format", 400, "INVALID_URL");
  }

  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);

  if (host === "github.com" || host.endsWith(".github.com")) {
    if (parts.length < 4) {
      throw new AppError("Unsupported GitHub URL path", 400, "INVALID_FORGE_URL");
    }
    const [owner, repo, section, id] = parts;
    const ownerRepo = `${owner}/${repo}`;
    if (section === "pull" || section === "pulls") {
      return {
        provider: "github",
        kind: "pr",
        ownerRepo,
        identifier: id,
        externalRef: `${ownerRepo}#${id}`,
      };
    }
    if (section === "issues") {
      return {
        provider: "github",
        kind: "issue",
        ownerRepo,
        identifier: id,
        externalRef: `${ownerRepo}#${id}`,
      };
    }
    if (section === "commit" || section === "commits") {
      return {
        provider: "github",
        kind: "commit",
        ownerRepo,
        identifier: id,
        externalRef: `${ownerRepo}@${id.slice(0, 7)}`,
      };
    }
    throw new AppError("GitHub URL must point to a pull request, issue, or commit", 400);
  }

  if (host === "gitlab.com" || host.includes("gitlab")) {
    const dashIdx = parts.indexOf("-");
    const splitIdx =
      dashIdx !== -1
        ? dashIdx
        : parts.findIndex((p) =>
            ["merge_requests", "issues", "commit", "commits"].includes(p)
          );

    if (splitIdx <= 0 || splitIdx >= parts.length - 1) {
      throw new AppError("Unsupported GitLab URL path", 400, "INVALID_FORGE_URL");
    }

    const ownerRepo = parts.slice(0, splitIdx).join("/");
    const section = dashIdx !== -1 ? parts[dashIdx + 1] : parts[splitIdx];
    const id = dashIdx !== -1 ? parts[dashIdx + 2] : parts[splitIdx + 1];

    if (!section || !id) {
      throw new AppError("Incomplete GitLab resource URL", 400);
    }

    if (section === "merge_requests") {
      return {
        provider: "gitlab",
        kind: "mr",
        ownerRepo,
        identifier: id,
        externalRef: `${ownerRepo}!${id}`,
      };
    }
    if (section === "issues") {
      return {
        provider: "gitlab",
        kind: "issue",
        ownerRepo,
        identifier: id,
        externalRef: `${ownerRepo}#${id}`,
      };
    }
    if (section === "commit" || section === "commits") {
      return {
        provider: "gitlab",
        kind: "commit",
        ownerRepo,
        identifier: id,
        externalRef: `${ownerRepo}@${id.slice(0, 7)}`,
      };
    }
    throw new AppError("GitLab URL must point to a merge request, issue, or commit", 400);
  }

  throw new AppError("Only GitHub and GitLab URLs are supported", 400, "UNSUPPORTED_PROVIDER");
}

async function fetchForgeMetadata(
  info: ParsedForgeUrl
): Promise<{ title: string; status: string }> {
  const defaultTitle =
    info.kind === "pr"
      ? `PR #${info.identifier} (${info.ownerRepo})`
      : info.kind === "mr"
      ? `MR !${info.identifier} (${info.ownerRepo})`
      : info.kind === "issue"
      ? `Issue #${info.identifier} (${info.ownerRepo})`
      : `Commit ${info.identifier.slice(0, 7)} (${info.ownerRepo})`;

  const defaultStatus = info.kind === "commit" ? "committed" : "open";

  try {
    if (info.provider === "github") {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "Patchwork-Tracker/1.0",
      };
      let githubToken = process.env.GITHUB_TOKEN;
      try {
        const integrations = await getSystemSetting("integrations");
        const decrypted = decryptIntegrationToken({
          ciphertext: integrations.githubTokenCiphertext,
          iv: integrations.githubTokenIv,
          authTag: integrations.githubTokenAuthTag,
        });
        if (decrypted) githubToken = decrypted;
      } catch {
        // ignore
      }
      if (githubToken) {
        headers.Authorization = `Bearer ${githubToken}`;
      }

      const apiPath =
        info.kind === "pr"
          ? `https://api.github.com/repos/${info.ownerRepo}/pulls/${info.identifier}`
          : info.kind === "issue"
          ? `https://api.github.com/repos/${info.ownerRepo}/issues/${info.identifier}`
          : `https://api.github.com/repos/${info.ownerRepo}/commits/${info.identifier}`;

      const res = await fetch(apiPath, {
        headers,
        signal: AbortSignal.timeout(2000),
      });

      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        if (info.kind === "commit") {
          const commitObj = data.commit as { message?: string } | undefined;
          const firstLine = commitObj?.message?.split("\n")[0] || defaultTitle;
          return { title: firstLine, status: "committed" };
        }
        const title = typeof data.title === "string" ? data.title : defaultTitle;
        const merged = Boolean(data.merged);
        const state = typeof data.state === "string" ? data.state : defaultStatus;
        return {
          title,
          status: merged ? "merged" : state,
        };
      }
    } else if (info.provider === "gitlab") {
      const encodedProject = encodeURIComponent(info.ownerRepo);
      const headers: Record<string, string> = {
        "User-Agent": "Patchwork-Tracker/1.0",
      };
      let gitlabToken = process.env.GITLAB_TOKEN;
      try {
        const integrations = await getSystemSetting("integrations");
        const decrypted = decryptIntegrationToken({
          ciphertext: integrations.gitlabTokenCiphertext,
          iv: integrations.gitlabTokenIv,
          authTag: integrations.gitlabTokenAuthTag,
        });
        if (decrypted) gitlabToken = decrypted;
      } catch {
        // ignore
      }
      if (gitlabToken) {
        headers["PRIVATE-TOKEN"] = gitlabToken;
      }

      const apiPath =
        info.kind === "mr"
          ? `https://gitlab.com/api/v4/projects/${encodedProject}/merge_requests/${info.identifier}`
          : info.kind === "issue"
          ? `https://gitlab.com/api/v4/projects/${encodedProject}/issues/${info.identifier}`
          : `https://gitlab.com/api/v4/projects/${encodedProject}/repository/commits/${info.identifier}`;

      const res = await fetch(apiPath, {
        headers,
        signal: AbortSignal.timeout(2000),
      });

      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        const title = typeof data.title === "string" ? data.title : defaultTitle;
        const state =
          typeof data.state === "string"
            ? data.state
            : info.kind === "commit"
            ? "committed"
            : defaultStatus;
        return { title, status: state };
      }
    }
  } catch {
    // Fallback to parsed metadata when offline or repo is private/synthetic
  }

  return { title: defaultTitle, status: defaultStatus };
}

export async function addTicketLink(
  actorId: string,
  ticketId: string,
  input: { url: string }
) {
  const { ticket } = await requireTicketRole(actorId, ticketId, "member");
  const parsed = parseForgeUrl(input.url);
  const metadata = await fetchForgeMetadata(parsed);

  const { link, domainEvent } = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(ticketLinks)
      .values({
        ticketId: ticket.id,
        createdById: actorId,
        provider: parsed.provider,
        kind: parsed.kind,
        url: input.url.trim(),
        title: metadata.title,
        status: metadata.status,
        externalRef: parsed.externalRef,
      })
      .returning();

    await recordActivity(
      {
        ticketId: ticket.id,
        actorId,
        action: "link.added",
        details: {
          linkId: inserted.id,
          provider: inserted.provider,
          kind: inserted.kind,
          externalRef: inserted.externalRef,
          title: inserted.title,
        },
      },
      tx
    );

    const ev = await emitDomainEvent(tx, {
      eventType: "link.added",
      aggregateId: ticket.id,
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      boardId: ticket.boardId,
      actorId,
      metadata: {
        ticketKey: ticket.key,
        linkId: inserted.id,
        provider: inserted.provider,
        kind: inserted.kind,
      },
    });

    return { link: inserted, domainEvent: ev };
  });

  await notifyDomainEventWorker(domainEvent?.id);

  await realtimeHub.publish({
    type: "link.added",
    orgId: ticket.orgId,
    teamId: ticket.teamId,
    boardId: ticket.boardId,
    ticketId: ticket.id,
    actorId,
    payload: { link },
  });

  return link;
}

export async function removeTicketLink(actorId: string, linkId: string) {
  const [link] = await db
    .select()
    .from(ticketLinks)
    .where(eq(ticketLinks.id, linkId))
    .limit(1);
  if (!link) throw new NotFoundError("Link not found");

  const { ticket } = await requireTicketRole(actorId, link.ticketId, "member");
  const domainEvent = await db.transaction(async (tx) => {
    await tx.delete(ticketLinks).where(eq(ticketLinks.id, linkId));

    await recordActivity(
      {
        ticketId: ticket.id,
        actorId,
        action: "link.removed",
        details: {
          linkId: link.id,
          externalRef: link.externalRef,
          url: link.url,
        },
      },
      tx
    );

    return emitDomainEvent(tx, {
      eventType: "link.removed",
      aggregateId: ticket.id,
      orgId: ticket.orgId,
      teamId: ticket.teamId,
      boardId: ticket.boardId,
      actorId,
      metadata: {
        ticketKey: ticket.key,
        linkId: link.id,
      },
    });
  });

  await notifyDomainEventWorker(domainEvent?.id);

  await realtimeHub.publish({
    type: "link.removed",
    orgId: ticket.orgId,
    teamId: ticket.teamId,
    boardId: ticket.boardId,
    ticketId: ticket.id,
    actorId,
    payload: { linkId: link.id },
  });
}

export async function testForgeConnection(
  provider: "github" | "gitlab",
  customToken?: string
): Promise<{ success: boolean; message: string; user?: string }> {
  try {
    let token = customToken;
    if (!token) {
      const integrations = await getSystemSetting("integrations");
      if (provider === "github") {
        token =
          decryptIntegrationToken({
            ciphertext: integrations.githubTokenCiphertext,
            iv: integrations.githubTokenIv,
            authTag: integrations.githubTokenAuthTag,
          }) || process.env.GITHUB_TOKEN;
      } else {
        token =
          decryptIntegrationToken({
            ciphertext: integrations.gitlabTokenCiphertext,
            iv: integrations.gitlabTokenIv,
            authTag: integrations.gitlabTokenAuthTag,
          }) || process.env.GITLAB_TOKEN;
      }
    }

    if (provider === "github") {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "Patchwork-Tracker/1.0",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("https://api.github.com/user", {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = (await res.json()) as { login?: string };
        return {
          success: true,
          message: `Connected successfully as ${data.login || "authenticated user"}`,
          user: data.login,
        };
      }
      return {
        success: false,
        message: `GitHub responded with status ${res.status} (${res.statusText})`,
      };
    } else {
      const headers: Record<string, string> = {
        "User-Agent": "Patchwork-Tracker/1.0",
      };
      if (token) headers["PRIVATE-TOKEN"] = token;
      const res = await fetch("https://gitlab.com/api/v4/user", {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = (await res.json()) as { username?: string };
        return {
          success: true,
          message: `Connected successfully as ${data.username || "authenticated user"}`,
          user: data.username,
        };
      }
      return {
        success: false,
        message: `GitLab responded with status ${res.status} (${res.statusText})`,
      };
    }
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

