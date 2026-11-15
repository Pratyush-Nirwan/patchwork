import fs from "fs";
import path from "path";
import type { PoolClient, Client, Pool } from "pg";

export interface DuplicateEmailResolution {
  keptUser: {
    id: string;
    name: string;
    email: string;
    createdAt: string;
  };
  renamedUsers: Array<{
    id: string;
    name: string;
    oldEmail: string;
    newEmail: string;
    createdAt: string;
  }>;
}

export async function deduplicateExistingEmails(
  client: PoolClient | Client | Pool,
  logsDir: string = path.join(process.cwd(), "logs")
): Promise<{
  duplicatesFound: number;
  renamedCount: number;
  reportPath: string | null;
  resolutions: DuplicateEmailResolution[];
}> {
  // 1. Check if users table exists
  const tableCheck = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'`
  );
  if (tableCheck.rowCount === 0) {
    return { duplicatesFound: 0, renamedCount: 0, reportPath: null, resolutions: [] };
  }

  // 2. Query for duplicate lower(email) groups
  const duplicatesQuery = `
    SELECT id, name, email, created_at
    FROM users
    WHERE lower(email) IN (
      SELECT lower(email)
      FROM users
      GROUP BY lower(email)
      HAVING count(*) > 1
    )
    ORDER BY lower(email) ASC, created_at ASC, id ASC
  `;

  const res = await client.query(duplicatesQuery);
  if (!res.rows || res.rows.length === 0) {
    return { duplicatesFound: 0, renamedCount: 0, reportPath: null, resolutions: [] };
  }

  // Group by lower(email)
  const groups = new Map<string, Array<{ id: string; name: string; email: string; created_at: Date | string }>>();
  for (const row of res.rows) {
    const key = String(row.email || "").trim().toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(row);
  }

  const resolutions: DuplicateEmailResolution[] = [];
  let totalRenamed = 0;

  for (const [, userRows] of groups.entries()) {
    if (userRows.length <= 1) continue;

    // Oldest record (index 0) is kept unchanged
    const oldest = userRows[0];
    const resolution: DuplicateEmailResolution = {
      keptUser: {
        id: String(oldest.id),
        name: String(oldest.name || ""),
        email: String(oldest.email),
        createdAt: new Date(oldest.created_at).toISOString(),
      },
      renamedUsers: [],
    };

    // Later duplicates (index 1..n) are renamed to <local>+duplicate-<id>@invalid.local
    for (let i = 1; i < userRows.length; i++) {
      const dup = userRows[i];
      const dupId = String(dup.id);
      const rawLocal = String(dup.email || "").split("@")[0].trim().toLowerCase() || "user";
      const sanitizedLocal = rawLocal.replace(/[^a-z0-9._-]/g, "") || "user";
      const newEmail = `${sanitizedLocal}+duplicate-${dupId}@invalid.local`;

      await client.query("UPDATE users SET email = $1 WHERE id = $2", [newEmail, dupId]);

      resolution.renamedUsers.push({
        id: dupId,
        name: String(dup.name || ""),
        oldEmail: String(dup.email),
        newEmail,
        createdAt: new Date(dup.created_at).toISOString(),
      });
      totalRenamed++;
    }

    resolutions.push(resolution);
  }

  if (totalRenamed === 0) {
    return { duplicatesFound: 0, renamedCount: 0, reportPath: null, resolutions: [] };
  }

  // 3. Write report to logs/duplicate-emails-<timestamp>.txt
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportFileName = `duplicate-emails-${timestamp}.txt`;
  const reportPath = path.join(logsDir, reportFileName);

  const lines: string[] = [
    `================================================================================`,
    `PATCHWORK DATABASE MIGRATION: DUPLICATE EMAIL AUDIT REPORT`,
    `Generated at: ${new Date().toISOString()}`,
    `Duplicate email groups resolved: ${resolutions.length}`,
    `Total duplicate accounts renamed: ${totalRenamed}`,
    `================================================================================`,
    ``,
    `Per database requirements, each email must belong to exactly one user.`,
    `For each duplicate email, the oldest record was preserved unchanged.`,
    `Later duplicates were renamed to an invalid placeholder (<local>+duplicate-<id>@invalid.local)`,
    `allowing the unique index on lower(email) to be safely created.`,
    ``,
    `DETAILS:`,
  ];

  for (const r of resolutions) {
    lines.push(`--------------------------------------------------------------------------------`);
    lines.push(`Email: ${r.keptUser.email.toLowerCase()}`);
    lines.push(`  [KEPT OLDEST RECORD]`);
    lines.push(`    User ID:    ${r.keptUser.id}`);
    lines.push(`    Name:       ${r.keptUser.name}`);
    lines.push(`    Email:      ${r.keptUser.email}`);
    lines.push(`    Created At: ${r.keptUser.createdAt}`);
    lines.push(`  [RENAMED DUPLICATES]`);
    for (const d of r.renamedUsers) {
      lines.push(`    User ID:        ${d.id}`);
      lines.push(`    Name:           ${d.name}`);
      lines.push(`    Original Email: ${d.oldEmail}`);
      lines.push(`    New Email:      ${d.newEmail}`);
      lines.push(`    Created At:     ${d.createdAt}`);
    }
  }

  lines.push(`================================================================================`);
  lines.push(``);

  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");

  // 4. Print clear console message
  console.log(`\n[Database Migration] Detected ${resolutions.length} duplicate email address(es).`);
  console.log(`[Database Migration] Renamed ${totalRenamed} duplicate account(s) to unique placeholders:`);
  for (const r of resolutions) {
    for (const d of r.renamedUsers) {
      console.log(`  - Renamed "${d.name}" (${d.id}): ${d.oldEmail} -> ${d.newEmail}`);
    }
  }
  console.log(`[Database Migration] Duplicate report written to: ${reportPath}\n`);

  return {
    duplicatesFound: resolutions.length,
    renamedCount: totalRenamed,
    reportPath,
    resolutions,
  };
}
