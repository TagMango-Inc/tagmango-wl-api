// Pause, resume or inspect the build queue, so the worker can be redeployed
// between jobs without killing a build.
//   node scripts/perf/queue.js status|pause|resume|wait-idle
// pause stops the worker picking up new jobs; the running job finishes and
// queued jobs stay in Redis. wait-idle returns once nothing is running.
const path = require("path");

const REPO = process.env.WL_REPO || path.resolve(__dirname, "..", "..");
const { Queue } = require(path.join(REPO, "node_modules", "bullmq"));

const queue = new Queue("buildQueue", { connection: { host: "localhost", port: 6379 } });

const status = async () => {
  const counts = await queue.getJobCounts("active", "waiting", "delayed", "prioritized", "paused");
  const paused = await queue.isPaused();
  console.log(new Date().toISOString(), { queuePaused: paused, ...counts });
  return counts;
};

(async () => {
  const action = process.argv[2] ?? "status";
  if (action === "pause") await queue.pause();
  if (action === "resume") await queue.resume();
  if (action === "wait-idle") {
    while ((await status()).active > 0) await new Promise((r) => setTimeout(r, 15_000));
  }
  await status();
  await queue.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
