// Pause, resume or inspect the job queues, so the worker can be redeployed
// between jobs without killing a build.
//   node scripts/queue.js status|pause|resume|wait-idle [queue ...]
// Defaults to buildQueue, androidBuildQueue and redeploymentQueue. pause stops
// workers picking up new jobs; running jobs finish and queued jobs stay in
// Redis. wait-idle returns once nothing is running.
//
//   node scripts/queue.js lanes [on|off]
// Shows or switches the Android lane. On, new Android jobs go to
// androidBuildQueue and build alongside iOS; off, every new job goes to
// buildQueue (one build at a time). Takes effect on the next job queued, no
// restart; jobs already queued stay in the lane they were added to.
const path = require("path");

const REPO = process.env.WL_REPO || path.resolve(__dirname, "..");
const { Queue } = require(path.join(REPO, "node_modules", "bullmq"));

const connection = { host: "localhost", port: 6379 };
const ANDROID_LANE_KEY = "wl:android-lane"; // read by src/job/config.ts buildQueueFor
const [action = "status", ...names] = process.argv.slice(2);
const queues = (
  action === "lanes" || !names.length
    ? ["buildQueue", "androidBuildQueue", "redeploymentQueue"]
    : names
).map((name) => new Queue(name, { connection }));

const lanes = async (to) => {
  const client = await queues[0].client;
  if (to === "on") await client.set(ANDROID_LANE_KEY, "1");
  else if (to === "off") await client.del(ANDROID_LANE_KEY);
  else if (to !== undefined) throw new Error(`lanes takes on or off, not "${to}"`);
  const on = (await client.get(ANDROID_LANE_KEY)) === "1";
  console.log(`android lane: ${on ? "on (Android and iOS build at the same time)" : "off (one build at a time)"}`);
};

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
  if (!["status", "pause", "resume", "wait-idle", "lanes"].includes(action)) {
    throw new Error(`unknown action "${action}" (status|pause|resume|wait-idle|lanes)`);
  }
  if (action === "lanes") await lanes(names[0]);
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
