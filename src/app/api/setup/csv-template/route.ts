import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { setupState } from "@/db/schema";

export async function GET() {
  const [state] = await db
    .select()
    .from(setupState)
    .where(eq(setupState.id, "default"))
    .limit(1);

  const visibleCols = new Set(
    state?.draftData?.employeeVisibleColumns ?? ["team", "projects", "roleNotes"]
  );

  const headers = ["name", "email", "role"];
  if (visibleCols.has("team")) headers.push("team");
  if (visibleCols.has("projects")) headers.push("projects");
  if (visibleCols.has("roleNotes")) headers.push("role_notes");
  headers.push("password");

  const row1 = ["Alan Shepard", "alan.shepard@orbital.dev", "team lead"];
  if (visibleCols.has("team")) row1.push("flight-control");
  if (visibleCols.has("projects")) row1.push("Orbital Ops");
  if (visibleCols.has("roleNotes")) row1.push("Flight Director");
  row1.push("AlanS@4821");

  const row2 = ["Margaret Hamilton", "margaret.hamilton@orbital.dev", "member"];
  if (visibleCols.has("team")) row2.push("flight-control");
  if (visibleCols.has("projects")) row2.push("Orbital Ops");
  if (visibleCols.has("roleNotes")) row2.push("Guidance Software");
  row2.push("MargaretH@9182");

  const csvContent = [headers.join(","), row1.join(","), row2.join(",")].join("\n");

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="patchwork-employees-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}

