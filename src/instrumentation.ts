export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureMigrated } = await import("./db");
    await ensureMigrated();

    if (
      process.env.WORKER_MODE !== "separate" &&
      process.env.NODE_ENV !== "test" &&
      !process.env.NEXT_PHASE
    ) {
      const { backgroundWorker } = await import("./lib/worker");
      await backgroundWorker.start("embedded");

      const globalForSig = globalThis as unknown as { __pwWorkerSig?: boolean };
      if (!globalForSig.__pwWorkerSig) {
        globalForSig.__pwWorkerSig = true;
        const shutdown = () => {
          backgroundWorker.stop().catch(() => undefined);
        };
        process.once("SIGTERM", shutdown);
        process.once("SIGINT", shutdown);
      }
    }
  }
}

