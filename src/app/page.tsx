import { redirect } from "next/navigation";
import { ensureMigrated } from "@/db";
import { getSetupStatus } from "@/lib/setup";
import { PatchworkApp } from "@/components/PatchworkApp";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await ensureMigrated();
  const status = await getSetupStatus();
  if (!status.isCompleted) {
    redirect("/setup");
  }
  return <PatchworkApp />;
}
