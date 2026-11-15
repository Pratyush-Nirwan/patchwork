export type WorkflowStage =
  | "backlog"
  | "new"
  | "in_progress"
  | "in_review"
  | "qa"
  | "done"
  | "custom";

export function getColumnStage(name: string): WorkflowStage {
  const norm = name.trim().toLowerCase().replace(/[-_\s]+/g, " ");
  if (norm.includes("backlog")) return "backlog";
  if (norm === "new" || norm.startsWith("new ") || norm.includes("to do") || norm.includes("todo")) {
    return "new";
  }
  if (
    norm.includes("progress") ||
    norm.includes("doing") ||
    norm.includes("development") ||
    norm.includes("in dev") ||
    norm === "dev"
  ) {
    return "in_progress";
  }
  if (norm.includes("review") || norm.includes("peer review") || norm.includes("code review")) {
    return "in_review";
  }
  if (
    norm.includes("qa") ||
    norm.includes("testing") ||
    norm.includes("test") ||
    norm.includes("verification")
  ) {
    return "qa";
  }
  if (
    norm.includes("done") ||
    norm.includes("completed") ||
    norm.includes("closed") ||
    norm.includes("shipped")
  ) {
    return "done";
  }
  return "custom";
}

export function checkSubRoleTransition(
  role: string,
  subRole: string,
  sourceColName: string,
  targetColName: string
): string | null {
  if (role === "admin" || role === "lead") return null;
  if (role === "viewer") return "Viewers have read-only access and cannot move tickets.";

  const sStage = getColumnStage(sourceColName);
  const tStage = getColumnStage(targetColName);

  if (subRole === "developer") {
    if (tStage === "done") {
      return "Only Testers, Team Leads, or Admins can sign off and move tickets to Done.";
    }
    if (sStage === "qa") {
      return "Developers cannot transition tickets out of QA. Only Testers or Team Leads can verify or reject QA tickets.";
    }
  } else if (subRole === "tester") {
    if ((sStage === "backlog" || sStage === "new") && tStage === "in_progress") {
      return "Testers cannot move tickets to In Progress. Only Developers or Team Leads can start development.";
    }
    if (sStage === "in_progress" && tStage === "in_review") {
      return "Testers cannot move tickets from In Progress to In Review. Only Developers can submit code for review.";
    }
    if ((sStage === "in_progress" || sStage === "in_review") && tStage === "done") {
      return "Tickets must be tested in QA before being moved to Done.";
    }
  }

  return null;
}
