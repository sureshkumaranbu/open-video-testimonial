/** Starts the background worker once per server process (not during `next build`). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startBackgroundWorker } = await import("./lib/worker");
  startBackgroundWorker();
}
