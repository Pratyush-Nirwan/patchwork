import { pool } from "@/db";
import { getAccessibleTeamIds } from "./rbac";
import { AppError } from "./errors";
import { parseSearchQuery, type SearchFilterTokens } from "./commands/parser";

export interface SearchResultItem {
  kind: "ticket" | "comment" | "attachment";
  id: string;
  ticketId: string;
  ticketKey: string;
  ticketTitle: string;
  boardId: string;
  teamId: string;
  orgId: string;
  rank: number;
  snippet: string;
  filename?: string;
}

export async function searchWorkspace(
  userId: string,
  rawQuery: string,
  options?: { orgId?: string; limit?: number }
): Promise<SearchResultItem[]> {
  const query = rawQuery.trim();
  if (!query) return [];

  const accessibleTeamIds = await getAccessibleTeamIds(userId, options?.orgId);
  if (accessibleTeamIds.length === 0) return [];

  const limit = Math.min(options?.limit || 25, 50);

  const sqlQuery = `
    WITH q AS (
      SELECT websearch_to_tsquery('english', $1) AS tsq
    ),
    combined AS (
      SELECT
        'ticket'::text AS kind,
        t.id AS id,
        t.id AS ticket_id,
        t.key AS ticket_key,
        t.title AS ticket_title,
        t.board_id AS board_id,
        t.team_id AS team_id,
        t.org_id AS org_id,
        ts_rank_cd(t.search_vector, q.tsq) * 1.5 AS rank,
        ts_headline(
          'english',
          concat_ws(' — ', t.key, t.title, t.description, t.labels_text),
          q.tsq,
          'StartSel=<mark>, StopSel=</mark>, MaxWords=28, MinWords=10, ShortWord=2'
        ) AS snippet,
        NULL::text AS filename
      FROM tickets t, q
      WHERE t.team_id = ANY($2::uuid[])
        AND t.archived_at IS NULL
        AND t.search_vector @@ q.tsq

      UNION ALL

      SELECT
        'comment'::text AS kind,
        c.id AS id,
        t.id AS ticket_id,
        t.key AS ticket_key,
        t.title AS ticket_title,
        t.board_id AS board_id,
        t.team_id AS team_id,
        t.org_id AS org_id,
        ts_rank_cd(c.search_vector, q.tsq) * 1.1 AS rank,
        ts_headline(
          'english',
          c.body,
          q.tsq,
          'StartSel=<mark>, StopSel=</mark>, MaxWords=28, MinWords=10, ShortWord=2'
        ) AS snippet,
        NULL::text AS filename
      FROM ticket_comments c
      INNER JOIN tickets t ON t.id = c.ticket_id, q
      WHERE c.team_id = ANY($2::uuid[])
        AND t.archived_at IS NULL
        AND c.search_vector @@ q.tsq

      UNION ALL

      SELECT
        'attachment'::text AS kind,
        a.id AS id,
        t.id AS ticket_id,
        t.key AS ticket_key,
        t.title AS ticket_title,
        t.board_id AS board_id,
        t.team_id AS team_id,
        t.org_id AS org_id,
        ts_rank_cd(a.search_vector, q.tsq) * 1.0 AS rank,
        ts_headline(
          'english',
          concat_ws(' — ', a.filename, a.extracted_text),
          q.tsq,
          'StartSel=<mark>, StopSel=</mark>, MaxWords=28, MinWords=10, ShortWord=2'
        ) AS snippet,
        a.filename AS filename
      FROM ticket_attachments a
      INNER JOIN tickets t ON t.id = a.ticket_id, q
      WHERE a.team_id = ANY($2::uuid[])
        AND t.archived_at IS NULL
        AND a.search_vector @@ q.tsq
    )
    SELECT *
    FROM combined
    ORDER BY rank DESC
    LIMIT $3
  `;

  const res = await pool.query(sqlQuery, [query, accessibleTeamIds, limit]);
  return res.rows.map((r) => ({
    kind: r.kind as "ticket" | "comment" | "attachment",
    id: String(r.id),
    ticketId: String(r.ticket_id),
    ticketKey: String(r.ticket_key),
    ticketTitle: String(r.ticket_title),
    boardId: String(r.board_id),
    teamId: String(r.team_id),
    orgId: String(r.org_id),
    rank: Number(r.rank),
    snippet: String(r.snippet),
    filename: r.filename ? String(r.filename) : undefined,
  }));
}

export interface ScopedEntityBoard {
  id: string;
  name: string;
  projectKey: string;
  projectName: string;
  teamId: string;
  teamName: string;
}

export interface ScopedEntityProject {
  id: string;
  key: string;
  name: string;
  teamId: string;
  teamName: string;
}

export interface ScopedEntityTeam {
  id: string;
  name: string;
  slug: string;
}

export interface ScopedEntityPerson {
  id: string;
  name: string;
  email: string;
  teamId: string;
  teamName: string;
}

export interface ScopedEntityLabel {
  label: string;
  count: number;
}

export interface ScopedSearchGroups {
  tickets: SearchResultItem[];
  comments: SearchResultItem[];
  attachments: SearchResultItem[];
  boards: ScopedEntityBoard[];
  projects: ScopedEntityProject[];
  teams: ScopedEntityTeam[];
  people: ScopedEntityPerson[];
  labels: ScopedEntityLabel[];
}

function hasActiveFilterTokens(f: SearchFilterTokens): boolean {
  return Boolean(
    f.inScope ||
      f.status ||
      f.priority ||
      f.assignee ||
      f.label ||
      f.due ||
      f.has ||
      f.watching
  );
}

export async function searchWorkspaceScoped(
  userId: string,
  rawQuery: string,
  options?: { orgId?: string; limit?: number }
): Promise<{ results: SearchResultItem[]; groups: ScopedSearchGroups }> {
  const emptyGroups: ScopedSearchGroups = {
    tickets: [],
    comments: [],
    attachments: [],
    boards: [],
    projects: [],
    teams: [],
    people: [],
    labels: [],
  };

  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return { results: [], groups: emptyGroups };
  }

  const accessibleTeamIds = await getAccessibleTeamIds(userId, options?.orgId);
  if (accessibleTeamIds.length === 0) {
    return { results: [], groups: emptyGroups };
  }

  const limit = Math.min(Math.max(options?.limit || 25, 1), 100);
  const filters = parseSearchQuery(trimmed);
  const hasFilters = hasActiveFilterTokens(filters);

  // Build parameterized ticket filter query when filter tokens or textQuery are present
  const params: unknown[] = [accessibleTeamIds];
  const conditions: string[] = ["t.team_id = ANY($1::uuid[])"];

  if (filters.status?.toLowerCase() === "archived") {
    conditions.push("t.archived_at IS NOT NULL");
  } else {
    conditions.push("t.archived_at IS NULL");
  }

  if (filters.inScope) {
    params.push(`%${filters.inScope}%`);
    const idx = params.length;
    conditions.push(
      `(p.key ILIKE $${idx} OR p.name ILIKE $${idx} OR tm.slug ILIKE $${idx} OR tm.name ILIKE $${idx} OR b.name ILIKE $${idx})`
    );
  }

  if (filters.status && filters.status.toLowerCase() !== "archived") {
    params.push(`%${filters.status}%`);
    conditions.push(`c.name ILIKE $${params.length}`);
  }

  if (filters.priority) {
    params.push(filters.priority);
    conditions.push(`t.priority = $${params.length}`);
  }

  if (filters.watching === "me") {
    params.push(userId);
    conditions.push(
      `EXISTS (SELECT 1 FROM ticket_watchers tw WHERE tw.ticket_id = t.id AND tw.user_id = $${params.length} AND tw.unwatched_at IS NULL)`
    );
  }

  if (filters.assignee) {
    const aLower = filters.assignee.toLowerCase();
    if (aLower === "me") {
      params.push(userId);
      conditions.push(`t.assignee_id = $${params.length}`);
    } else if (aLower === "unassigned" || aLower === "none") {
      conditions.push("t.assignee_id IS NULL");
    } else {
      params.push(`%${filters.assignee}%`);
      const idx = params.length;
      conditions.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx})`);
    }
  }

  if (filters.label) {
    params.push(`%${filters.label}%`);
    conditions.push(`t.labels_text ILIKE $${params.length}`);
  }

  if (filters.due === "overdue") {
    conditions.push("t.due_date IS NOT NULL AND t.due_date < now()");
  } else if (filters.due === "today") {
    conditions.push("t.due_date IS NOT NULL AND t.due_date::date = CURRENT_DATE");
  } else if (filters.due === "week") {
    conditions.push(
      "t.due_date IS NOT NULL AND t.due_date >= now() AND t.due_date <= now() + interval '7 days'"
    );
  } else if (filters.due === "none") {
    conditions.push("t.due_date IS NULL");
  }

  if (filters.has === "attachments") {
    conditions.push("EXISTS (SELECT 1 FROM ticket_attachments ta WHERE ta.ticket_id = t.id)");
  } else if (filters.has === "links") {
    conditions.push("EXISTS (SELECT 1 FROM ticket_links tl WHERE tl.ticket_id = t.id)");
  } else if (filters.has === "comments") {
    conditions.push("EXISTS (SELECT 1 FROM ticket_comments tc WHERE tc.ticket_id = t.id)");
  }

  let ftsResults: SearchResultItem[] = [];
  if (filters.textQuery && !hasFilters) {
    ftsResults = await searchWorkspace(userId, filters.textQuery, {
      orgId: options?.orgId,
      limit,
    });
  } else {
    let rankExpr = "1.0";
    let snippetExpr = "left(coalesce(t.description, ''), 160)";
    if (filters.textQuery) {
      params.push(filters.textQuery);
      const qIdx = params.length;
      conditions.push(`t.search_vector @@ websearch_to_tsquery('english', $${qIdx})`);
      rankExpr = `ts_rank_cd(t.search_vector, websearch_to_tsquery('english', $${qIdx})) * 1.5`;
      snippetExpr = `ts_headline('english', concat_ws(' — ', t.title, t.description), websearch_to_tsquery('english', $${qIdx}), 'StartSel=<mark>, StopSel=</mark>, MaxWords=25, MinWords=8, ShortWord=2')`;
    }

    params.push(limit);
    const limitIdx = params.length;

    const filteredSql = `
      SELECT
        'ticket' AS kind,
        t.id::text AS id,
        t.id::text AS ticket_id,
        t.key AS ticket_key,
        t.title AS ticket_title,
        t.board_id AS board_id,
        t.team_id AS team_id,
        t.org_id AS org_id,
        ${rankExpr} AS rank,
        ${snippetExpr} AS snippet
      FROM tickets t
      INNER JOIN columns c ON c.id = t.column_id
      INNER JOIN boards b ON b.id = t.board_id
      INNER JOIN projects p ON p.id = t.project_id
      INNER JOIN teams tm ON tm.id = t.team_id
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY rank DESC, t.updated_at DESC
      LIMIT $${limitIdx}
    `;
    const ticketRes = await pool.query(filteredSql, params);
    ftsResults = ticketRes.rows.map((r) => ({
      kind: "ticket" as const,
      id: String(r.id),
      ticketId: String(r.ticket_id),
      ticketKey: String(r.ticket_key),
      ticketTitle: String(r.ticket_title),
      boardId: String(r.board_id),
      teamId: String(r.team_id),
      orgId: String(r.org_id),
      rank: Number(r.rank),
      snippet: String(r.snippet || ""),
    }));
  }

  // Also search scoped entities (boards, projects, teams, people, labels) when there is a text query
  const entityLike = filters.textQuery ? `%${filters.textQuery}%` : null;
  if (entityLike) {
    const [boardsRes, projectsRes, teamsRes, peopleRes, labelsRes] = await Promise.all([
      pool.query(
        `SELECT b.id::text, b.name, p.key AS project_key, p.name AS project_name, tm.id::text AS team_id, tm.name AS team_name
         FROM boards b
         INNER JOIN projects p ON p.id = b.project_id
         INNER JOIN teams tm ON tm.id = b.team_id
         WHERE b.team_id = ANY($1::uuid[]) AND (b.name ILIKE $2 OR p.key ILIKE $2)
         ORDER BY b.name ASC LIMIT 6`,
        [accessibleTeamIds, entityLike]
      ),
      pool.query(
        `SELECT p.id::text, p.key, p.name, tm.id::text AS team_id, tm.name AS team_name
         FROM projects p
         INNER JOIN teams tm ON tm.id = p.team_id
         WHERE p.team_id = ANY($1::uuid[]) AND (p.name ILIKE $2 OR p.key ILIKE $2)
         ORDER BY p.key ASC LIMIT 6`,
        [accessibleTeamIds, entityLike]
      ),
      pool.query(
        `SELECT id::text, name, slug
         FROM teams
         WHERE id = ANY($1::uuid[]) AND (name ILIKE $2 OR slug ILIKE $2)
         ORDER BY name ASC LIMIT 6`,
        [accessibleTeamIds, entityLike]
      ),
      pool.query(
        `SELECT DISTINCT ON (u.id) u.id::text, u.name, u.email, tm.id::text AS team_id, tm.name AS team_name
         FROM team_members m
         INNER JOIN users u ON u.id = m.user_id
         INNER JOIN teams tm ON tm.id = m.team_id
         WHERE m.team_id = ANY($1::uuid[]) AND u.is_deactivated = false AND (u.name ILIKE $2 OR u.email ILIKE $2)
         ORDER BY u.id, u.name ASC LIMIT 6`,
        [accessibleTeamIds, entityLike]
      ),
      pool.query(
        `SELECT lbl AS label, count(*)::int AS count
         FROM tickets t, unnest(t.labels) AS lbl
         WHERE t.team_id = ANY($1::uuid[]) AND t.archived_at IS NULL AND lbl ILIKE $2
         GROUP BY lbl
         ORDER BY count DESC, lbl ASC LIMIT 6`,
        [accessibleTeamIds, entityLike]
      ),
    ]);

    emptyGroups.boards = boardsRes.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      projectKey: String(r.project_key),
      projectName: String(r.project_name),
      teamId: String(r.team_id),
      teamName: String(r.team_name),
    }));
    emptyGroups.projects = projectsRes.rows.map((r) => ({
      id: String(r.id),
      key: String(r.key),
      name: String(r.name),
      teamId: String(r.team_id),
      teamName: String(r.team_name),
    }));
    emptyGroups.teams = teamsRes.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      slug: String(r.slug),
    }));
    emptyGroups.people = peopleRes.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      email: String(r.email),
      teamId: String(r.team_id),
      teamName: String(r.team_name),
    }));
    emptyGroups.labels = labelsRes.rows.map((r) => ({
      label: String(r.label),
      count: Number(r.count),
    }));
  }

  for (const hit of ftsResults) {
    if (hit.kind === "ticket") emptyGroups.tickets.push(hit);
    else if (hit.kind === "comment") emptyGroups.comments.push(hit);
    else if (hit.kind === "attachment") emptyGroups.attachments.push(hit);
  }

  return { results: ftsResults, groups: emptyGroups };
}

let isRebuildingSearchIndex = false;

export async function getSearchIndexStatus(): Promise<{
  indexedTickets: number;
  indexedComments: number;
  indexedAttachments: number;
  isRebuilding: boolean;
}> {
  const [ticketRes, commentRes, attachmentRes] = await Promise.all([
    pool.query("SELECT count(*)::int AS count FROM tickets WHERE search_vector IS NOT NULL"),
    pool.query("SELECT count(*)::int AS count FROM ticket_comments WHERE search_vector IS NOT NULL"),
    pool.query("SELECT count(*)::int AS count FROM ticket_attachments WHERE search_vector IS NOT NULL"),
  ]);

  return {
    indexedTickets: Number(ticketRes.rows[0]?.count || 0),
    indexedComments: Number(commentRes.rows[0]?.count || 0),
    indexedAttachments: Number(attachmentRes.rows[0]?.count || 0),
    isRebuilding: isRebuildingSearchIndex,
  };
}

export async function rebuildSearchIndex(): Promise<{
  indexedTickets: number;
  indexedComments: number;
  indexedAttachments: number;
}> {
  if (isRebuildingSearchIndex) {
    throw new AppError(
      "A search index rebuild is already in progress",
      409,
      "REBUILD_IN_PROGRESS"
    );
  }

  isRebuildingSearchIndex = true;
  const client = await pool.connect();
  try {
    await client.query("REINDEX INDEX tickets_search_idx");
    await client.query("REINDEX INDEX ticket_comments_search_idx");
    await client.query("REINDEX INDEX ticket_attachments_search_idx");

    const [ticketRes, commentRes, attachmentRes] = await Promise.all([
      client.query("SELECT count(*)::int AS count FROM tickets WHERE search_vector IS NOT NULL"),
      client.query("SELECT count(*)::int AS count FROM ticket_comments WHERE search_vector IS NOT NULL"),
      client.query("SELECT count(*)::int AS count FROM ticket_attachments WHERE search_vector IS NOT NULL"),
    ]);

    return {
      indexedTickets: Number(ticketRes.rows[0]?.count || 0),
      indexedComments: Number(commentRes.rows[0]?.count || 0),
      indexedAttachments: Number(attachmentRes.rows[0]?.count || 0),
    };
  } finally {
    isRebuildingSearchIndex = false;
    client.release();
  }
}


