import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { orgMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { validateSessionTokenDetailed, SESSION_COOKIE_NAME } from "@/lib/auth";
import { SystemConfigView } from "@/components/SystemConfigView";

export default async function SystemConfigPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    redirect("/");
  }

  const resolvedParams = await params;
  const sectionPart = resolvedParams.section?.[0] || "users";
  const currentPath = resolvedParams.section?.length
    ? `/dashboard/system/${resolvedParams.section.join("/")}`
    : "/dashboard/system";

  const { auth, reason } = await validateSessionTokenDetailed(sessionToken, {
    skipTouch: true,
  });
  if (!auth) {
    if (reason === "idle_expired") {
      redirect(`/?reason=idle_expired&returnTo=${encodeURIComponent(currentPath)}`);
    }
    redirect("/");
  }

  // Server-side admin verification
  const adminMembership = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, auth.user.id), eq(orgMembers.role, "admin")))
    .limit(1);

  if (adminMembership.length === 0) {
    // Defense-in-depth: If reached without admin role, forbidden
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--pw-bg)] text-[var(--pw-ink)] p-4">
        <div className="rounded border border-red-500/30 bg-red-500/10 p-6 text-center max-w-md">
          <h1 className="text-base font-bold text-red-600 mb-2">403 - Forbidden</h1>
          <p className="text-xs text-[var(--pw-ink-secondary)] mb-4">
            Organization administrator privileges are required to access System Configuration.
          </p>
          <Link
            href="/"
            className="rounded bg-[var(--pw-accent)] px-3 py-1.5 text-xs font-semibold text-white inline-block"
          >
            Return to Workspace
          </Link>
        </div>
      </div>
    );
  }

  return <SystemConfigView initialSection={sectionPart} />;
}
