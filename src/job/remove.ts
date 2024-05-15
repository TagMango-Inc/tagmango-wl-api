import { buildQueue } from "./config";

(async () => {
  const allJobs = await buildQueue.getJobs();

  for (const job of allJobs) {
    await job.remove();
  }
})().finally(() => {
  process.exit(0);
});
