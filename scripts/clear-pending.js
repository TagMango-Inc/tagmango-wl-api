// Drops every queued (not running) build job and deletes its pending
// deployment, e.g. before switching data/release.json to a new native release
// so the next bulk redeploy queues every app again on the new version.
//   node scripts/queue.js pause
//   node scripts/clear-pending.js [--platform ios|android]           # dry run
//   node scripts/clear-pending.js [--platform ios|android] --apply
//
// Needs both build queues paused (so the worker can't start a job while it is
// being removed) and no bulk redeploy still creating deployments. A running
// job and its deployment are left alone. The deleted deployments are written
// to migration-backups/ first.
const fs = require("fs");
const path = require("path");

const REPO = process.env.WL_REPO || path.resolve(__dirname, "..");
require(path.join(REPO, "node_modules", "dotenv")).config({ path: path.join(REPO, ".env") });
const { Queue } = require(path.join(REPO, "node_modules", "bullmq"));
const { MongoClient, ObjectId } = require(path.join(REPO, "node_modules", "mongodb"));

const connection = { host: "localhost", port: Number(process.env.WL_REDIS_PORT) || 6379 };
const QUEUED_STATES = ["waiting", "paused", "delayed", "prioritized", "waiting-children"];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const platformArg = args.includes("--platform") ? args[args.indexOf("--platform") + 1] : undefined;
if (platformArg && !["ios", "android"].includes(platformArg)) {
  throw new Error(`--platform takes ios or android, not "${platformArg}"`);
}

(async () => {
  const buildQueues = ["buildQueue", "androidBuildQueue"].map((name) => new Queue(name, { connection }));
  const redeploymentQueue = new Queue("redeploymentQueue", { connection });
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error(`MONGO_URI not set (looked in ${path.join(REPO, ".env")})`);
  const mongo = new MongoClient(uri);

  try {
    for (const queue of buildQueues) {
      if (!(await queue.isPaused())) {
        throw new Error(`${queue.name} is not paused: run node scripts/queue.js pause first`);
      }
    }
    const redeploys = await redeploymentQueue.getJobCounts("active", "waiting", "delayed", "prioritized");
    if (Object.values(redeploys).some((n) => n > 0)) {
      throw new Error(`a bulk redeploy is still creating deployments (redeploymentQueue ${JSON.stringify(redeploys)}); wait for it to finish`);
    }

    await mongo.connect();
    const deployments = mongo.db(uri.split("?")[0].split("/").pop()).collection("wldeployments");

    const activeIds = new Set();
    const queuedJobs = [];
    for (const queue of buildQueues) {
      for (const job of await queue.getJobs(["active"])) activeIds.add(job.id);
      for (const job of await queue.getJobs(QUEUED_STATES)) {
        if (!platformArg || job.data?.platform === platformArg) queuedJobs.push({ queue: queue.name, job });
      }
    }

    const filter = { status: "pending", ...(platformArg && { platform: platformArg }) };
    const pending = (await deployments.find(filter, { projection: { tasks: 0 } }).toArray()).filter(
      (d) => !activeIds.has(d._id.toString()),
    );

    const byPlatform = (list, get) =>
      JSON.stringify(list.reduce((acc, x) => ({ ...acc, [get(x)]: (acc[get(x)] ?? 0) + 1 }), {}));
    console.log(`running jobs left alone: ${activeIds.size ? [...activeIds].join(", ") : "none"}`);
    console.log(`queued build jobs: ${queuedJobs.length} ${byPlatform(queuedJobs, (q) => `${q.queue}/${q.job.data?.platform}`)}`);
    console.log(`pending deployments: ${pending.length} ${byPlatform(pending, (d) => `${d.platform} ${d.versionName}`)}`);
    const pendingIds = new Set(pending.map((d) => d._id.toString()));
    const orphanJobs = queuedJobs.filter((q) => !pendingIds.has(q.job.id)).length;
    if (orphanJobs) console.log(`  ${orphanJobs} queued jobs have no pending deployment (removed too)`);

    if (!apply) {
      console.log("dry run: pass --apply to remove the jobs and delete the deployments");
      return;
    }

    const backupDir = path.join(REPO, "migration-backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `pending-deployments-${Date.now()}.json`);
    const full = await deployments.find({ _id: { $in: pending.map((d) => d._id) } }).toArray();
    fs.writeFileSync(backupFile, JSON.stringify(full));
    console.log(`backed up ${full.length} deployments to ${backupFile}`);

    let removed = 0;
    for (const { job } of queuedJobs) {
      try {
        await job.remove();
        removed++;
      } catch (e) {
        console.log(`  could not remove job ${job.id}: ${e.message}`);
      }
    }
    console.log(`removed ${removed}/${queuedJobs.length} queued jobs`);

    // status re-checked so a deployment that started meanwhile is kept
    const { deletedCount } = await deployments.deleteMany({
      _id: { $in: pending.map((d) => new ObjectId(d._id)) },
      status: "pending",
    });
    console.log(`deleted ${deletedCount}/${pending.length} pending deployments`);
    console.log("queues are still paused: node scripts/queue.js resume when ready");
  } finally {
    await Promise.all([...buildQueues, redeploymentQueue].map((q) => q.close()));
    await mongo.close();
  }
})().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
