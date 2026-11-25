import { ensureMigrated } from "@/db";
import { backgroundWorker } from "@/lib/worker";

async function main() {
  await ensureMigrated();
  await backgroundWorker.start("separate");
  console.log(`[patchwork-worker] Started separate worker (${backgroundWorker.workerId})`);

  const shutdown = async (signal: string) => {
    console.log(`[patchwork-worker] Received ${signal}, shutting down gracefully...`);
    await backgroundWorker.stop();
    process.exit(0);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[patchwork-worker] Fatal error:", err);
  process.exit(1);
});
