// Re-adds pending deployments whose build jobs are no longer in Redis, e.g.
// after the worker failed (and so removed) every queued job while Mongo was
// unreachable. Oldest first, so the queue keeps its original order.
//
//   node dist/src/job/requeue-pending.js            # dry run: counts only
//   node dist/src/job/requeue-pending.js --apply    # queue them
//
// Safe to rerun: a deployment already in either build lane is skipped, and
// jobId is the deployment id, so a duplicate add is a no-op anyway.
import "dotenv/config";

import Mongo from "../../src/database";
import { Status } from "../../src/types/database";
import { findBuildJob } from "./config";
import { queueExistingDeployment } from "./requeue";

const apply = process.argv.includes("--apply");

(async () => {
  await Mongo.connect();

  const pending = await Mongo.deployment
    .find({ status: Status.PENDING }, { projection: { tasks: 0 } })
    .sort({ _id: 1 })
    .toArray();

  let alreadyQueued = 0;
  let queued = 0;
  const skipped: string[] = [];

  for (const deployment of pending) {
    const id = deployment._id.toString();
    if (await findBuildJob(id)) {
      alreadyQueued++;
      continue;
    }
    if (!apply) {
      queued++;
      continue;
    }
    const result = await queueExistingDeployment(deployment, { lifo: false });
    if (result.ok) queued++;
    else skipped.push(`${id} ${deployment.platform}: ${result.message}`);
  }

  console.log(
    `${pending.length} pending: ${alreadyQueued} already queued, ` +
      `${queued} ${apply ? "queued" : "to queue (dry run, pass --apply)"}, ` +
      `${skipped.length} skipped`,
  );
  for (const line of skipped) console.log(`  skipped ${line}`);
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
