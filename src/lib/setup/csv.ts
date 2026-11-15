import { normalizeEmail,isValidEmailFormat } from "../email";
import type { SetupDraftEmployee } from "@/db/schema";
import { generateSystemPassword } from "./state";
import type { EmployeeCsvSkippedRow } from "./steps";

export function normalizeRoleInput(
  rawRole: string
): "admin" | "lead" | "member" | "viewer" | null {
  const cleaned = (rawRole || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (cleaned === "admin" || cleaned === "org admin") return "admin";
  if (cleaned === "lead" || cleaned === "team lead" || cleaned === "teamlead") {
    return "lead";
  }
  if (cleaned === "member" || cleaned === "developer") return "member";
  if (cleaned === "viewer" || cleaned === "readonly" || cleaned === "read only") {
    return "viewer";
  }
  return null;
}


export function parseEmployeeCsv(
  csvText: string,
  options?: { existingEmails?: Set<string> | string[] }
): {
  employees: SetupDraftEmployee[];
  parseErrors: Array<{ row: number; email?: string; field: string; message: string }>;
  skippedRows: EmployeeCsvSkippedRow[];
} {
  const lines = csvText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length === 0) {
    return {
      employees: [],
      parseErrors: [{ row: 1, field: "csv", message: "CSV file is empty" }],
      skippedRows: [],
    };
  }

  const rawHeaders = lines[0]
    .split(",")
    .map((c) => c.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  const hasHeader =
    rawHeaders.includes("email") ||
    rawHeaders.includes("name") ||
    rawHeaders.includes("role");

  const dataLines = hasHeader ? lines.slice(1) : lines;
  if (dataLines.length === 0) {
    return {
      employees: [],
      parseErrors: [
        { row: 1, field: "csv", message: "CSV contains header only and no employee rows" },
      ],
      skippedRows: [],
    };
  }

  const nameIdx = hasHeader ? rawHeaders.indexOf("name") : 0;
  const emailIdx = hasHeader ? rawHeaders.indexOf("email") : 1;
  const roleIdx = hasHeader ? rawHeaders.indexOf("role") : 2;
  const teamIdx = hasHeader
    ? rawHeaders.findIndex((c) => c === "team" || c === "teams" || c === "teamslug")
    : 3;
  const projectsIdx = hasHeader
    ? rawHeaders.findIndex((c) => c === "projects" || c === "project")
    : -1;
  const notesIdx = hasHeader
    ? rawHeaders.findIndex((c) => c === "rolenotes" || c === "notes" || c === "rolenote")
    : -1;
  const passIdx = hasHeader
    ? rawHeaders.findIndex(
      (c) =>
        c === "password" ||
        c === "temporarypassword" ||
        c === "temppass" ||
        c === "temppassword"
    )
    : 4;

  const existingEmailSet = options?.existingEmails
    ? options.existingEmails instanceof Set
      ? options.existingEmails
      : new Set(options.existingEmails.map((e) => normalizeEmail(e)))
    : null;

  const seenInFile = new Set<string>();
  const employees: SetupDraftEmployee[] = [];
  const parseErrors: Array<{
    row: number;
    email?: string;
    field: string;
    message: string;
  }> = [];
  const skippedRows: EmployeeCsvSkippedRow[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const rowNumber = hasHeader ? i + 2 : i + 1;
    const cols = dataLines[i].split(",").map((c) => c.trim());
    if (cols.length < 3) {
      parseErrors.push({
        row: rowNumber,
        field: "row",
        message: `Row ${rowNumber}: Expected at least 3 columns (name,email,role[,team,password])`,
      });
      continue;
    }

    const name = nameIdx !== -1 && nameIdx < cols.length ? cols[nameIdx] : cols[0] || "";
    const rawEmail = emailIdx !== -1 && emailIdx < cols.length ? cols[emailIdx] : cols[1] || "";
    const email = normalizeEmail(rawEmail);
    const rawRole = roleIdx !== -1 && roleIdx < cols.length ? cols[roleIdx] : cols[2] || "";
    const teamSlug = teamIdx !== -1 && teamIdx < cols.length ? cols[teamIdx] : "";
    const projectsRaw = projectsIdx !== -1 && projectsIdx < cols.length ? cols[projectsIdx] : "";
    const roleNotes = notesIdx !== -1 && notesIdx < cols.length ? cols[notesIdx] : undefined;
    const rawPass = passIdx !== -1 && passIdx < cols.length ? cols[passIdx] : "";

    const normalizedRole = normalizeRoleInput(rawRole);

    let hasError = false;
    if (!name) {
      parseErrors.push({
        row: rowNumber,
        email,
        field: "name",
        message: `Row ${rowNumber}: Name is required`,
      });
      hasError = true;
    }
    if (!email || !isValidEmailFormat(email)) {
      parseErrors.push({
        row: rowNumber,
        email,
        field: "email",
        message: `Row ${rowNumber}: Valid email is required`,
      });
      hasError = true;
    }
    if (!normalizedRole) {
      parseErrors.push({
        row: rowNumber,
        email,
        field: "role",
        message: `Row ${rowNumber}: Invalid role '${rawRole}' (must be admin, team lead, member, or viewer)`,
      });
      hasError = true;
    }
    if (rawPass && rawPass.length < 8) {
      parseErrors.push({
        row: rowNumber,
        email,
        field: "temporaryPassword",
        message: `Row ${rowNumber}: Password must be at least 8 characters`,
      });
      hasError = true;
    }

    if (hasError) {
      continue;
    }

    // Check duplicate in file
    if (seenInFile.has(email)) {
      skippedRows.push({
        line: rowNumber,
        row: rowNumber,
        email,
        reason: "duplicate in file",
      });
      continue;
    }

    // Check duplicate against existing users
    if (existingEmailSet && existingEmailSet.has(email)) {
      skippedRows.push({
        line: rowNumber,
        row: rowNumber,
        email,
        reason: "already exists",
      });
      continue;
    }

    seenInFile.add(email);

    const temporaryPassword = rawPass || generateSystemPassword(name);
    const projects = projectsRaw
      ? projectsRaw.split(";").map((p) => p.trim()).filter(Boolean)
      : undefined;

    employees.push({
      name,
      email,
      role: normalizedRole || ("member" as const),
      teamSlug: teamSlug || "",
      projects,
      roleNotes,
      temporaryPassword,
    });
  }

  return { employees, parseErrors, skippedRows };
}
