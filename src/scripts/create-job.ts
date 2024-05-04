import { builQueue } from "src/job/config";

const args = process.argv.slice(2);
const jobId = args[0];

async function run() {
  await builQueue.add(jobId, { id: jobId });
}

run().finally(() => process.exit(0));
