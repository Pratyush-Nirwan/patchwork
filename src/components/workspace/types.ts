export interface UserInfo {
  id: string;
  email: string;
  name: string;
  mustChangePassword?: boolean;
  isSetupAdmin?: boolean;
}

export interface BoardSummary {
  id: string;
  name: string;
  description: string;
  projectId: string;
  teamId: string;
  orgId: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  key: string;
  description: string;
  teamId: string;
  orgId: string;
  boards: BoardSummary[];
}

export interface TeamSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  orgId: string;
  effectiveRole: "admin" | "lead" | "member" | "viewer";
  effectiveSubRole?: string | null;
  projects: ProjectSummary[];
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  orgRole: "admin" | "member";
  teams: TeamSummary[];
}

export interface ColumnItem {
  id: string;
  boardId: string;
  name: string;
  position: number;
  wipLimit: number | null;
  color: string;
}

export interface TicketItem {
  id: string;
  orgId: string;
  teamId: string;
  projectId: string;
  boardId: string;
  columnId: string;
  number: number;
  key: string;
  title: string;
  description: string;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  labels: string[];
  assigneeId: string | null;
  reporterId: string | null;
  dueDate?: string | null;
  position: number;
  commentCount?: number;
  attachmentCount?: number;
  linkCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMemberItem {
  id: string;
  name: string;
  email: string;
  role: string;
  subRole?: string | null;
}

export interface BoardData {
  board: BoardSummary;
  project: ProjectSummary;
  team: TeamSummary;
  org: OrgSummary;
  role: "admin" | "lead" | "member" | "viewer";
  subRole?: "developer" | "tester" | null;
  columns: ColumnItem[];
  tickets: TicketItem[];
  members: TeamMemberItem[];
}

export interface TicketDetailsData {
  ticket: TicketItem;
  role: "admin" | "lead" | "member" | "viewer";
  subRole?: "developer" | "tester" | null;
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; name: string; email: string };
  }>;
  activities: Array<{
    id: string;
    action: string;
    details: Record<string, unknown>;
    createdAt: string;
    actor: { id: string; name: string; email: string } | null;
  }>;
  attachments: Array<{
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    downloadUrl: string;
    createdAt: string;
  }>;
  links: Array<{
    id: string;
    provider: "github" | "gitlab";
    kind: "pr" | "mr" | "issue" | "commit";
    url: string;
    title: string;
    status: string;
    externalRef: string;
    createdAt: string;
  }>;
}

export function getDefaultNewTicketColumnId(cols: ColumnItem[]): string {
  return (
    cols.find((c) => /\bnew\b/i.test(c.name)) ||
    cols.find((c) => /\bto\s*do\b/i.test(c.name)) ||
    cols[0]
  )?.id || "";
}
