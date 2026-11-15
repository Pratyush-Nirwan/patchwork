import { redirect } from "next/navigation";
import { ensureMigrated } from "@/db";
import { getSetupStatus } from "@/lib/setup";
import { SetupWizard } from "@/components/SetupWizard";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  await ensureMigrated();
  const status = await getSetupStatus();
  if (status.isCompleted) {
    redirect("/");
  }
  return <SetupWizard />;
}

