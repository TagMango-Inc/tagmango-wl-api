// Pause, resume or inspect the job queues, so the worker can be redeployed
// between jobs without killing a build.
//   node scripts/queue.js status|pause|resume|wait-idle [queue ...]
// Defaults to both buildQueue and redeploymentQueue. pause stops workers
// picking up new jobs; running jobs finish and queued jobs stay in Redis.
// wait-idle returns once nothing is running.
const path = require("path");

const REPO = process.env.WL_REPO || path.resolve(__dirname, "..");
const { Queue } = require(path.join(REPO, "node_modules", "bullmq"));

const connection = { host: "localhost", port: 6379 };
const [action = "status", ...names] = process.argv.slice(2);
const queues = (names.length ? names : ["buildQueue", "redeploymentQueue"]).map(
  (name) => new Queue(name, { connection }),
);

const status = async () => {
  let active = 0;
  for (const queue of queues) {
    const counts = await queue.getJobCounts("active", "waiting", "paused", "delayed", "prioritized");
    const paused = await queue.isPaused();
    active += counts.active;
    console.log(new Date().toISOString(), queue.name, JSON.stringify({ queuePaused: paused, ...counts }));
  }
  return active;
};

(async () => {
  if (!["status", "pause", "resume", "wait-idle"].includes(action)) {
    throw new Error(`unknown action "${action}" (status|pause|resume|wait-idle)`);
  }
  if (action === "pause") await Promise.all(queues.map((q) => q.pause()));
  if (action === "resume") await Promise.all(queues.map((q) => q.resume()));
  if (action === "wait-idle") {
    while ((await status()) > 0) await new Promise((r) => setTimeout(r, 15_000));
  } else {
    await status();
  }
  await Promise.all(queues.map((q) => q.close()));
})().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
