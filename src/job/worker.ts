import { Worker } from "bullmq";
import { exec } from "child_process";

import { queueRedisOptions } from "./config";

const worker = new Worker(
  "buildQueue",
  async (job) => {
    const { id } = job.data;
    console.log(`Processing job ${id}`);

    const e = exec(`node ./src/scripts/random-output ${id}`, {
      cwd: process.cwd(),
    });

    const { stdout, stderr } = e;

    if (stdout) {
      stdout.on("data", (data) => {
        console.log(data);
      });
    }
    if (stderr) {
      stderr.on("data", (data) => {
        console.error(data);
      });
    }

    const code = await new Promise((resolve, reject) => {
      e.on("close", resolve);
      e.on("error", reject);
    });
    console.log(`Job ${id} completed with code ${code}`);
  },
  {
    connection: queueRedisOptions,
    concurrency: 1,
  },
);

worker.on("stalled", (job) => {
  console.log("job is being stalled", job);
});

console.log("Worker started!");
