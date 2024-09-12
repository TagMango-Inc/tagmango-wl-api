import { buildQueue } from './config';

// pending -> waiting
// processing -> active

async function main() {
  // accept the processing or active jobs
  // const all = await buildQueue.getJobs();
  const waitedJobs = await buildQueue.getJobs(["waiting"]);
  const activeJobs = await buildQueue.getJobs(["active"]);
  // console.log('jobs:', jobs);
  for await (const job of waitedJobs) {
    console.log("job name", job.name);
    console.log("removing job:", await job.getState());
    // await job.remove();
  }
  console.log("*********************************");
  for await (const job of activeJobs) {
    console.log("job name", job.name);
    console.log("removing job:", await job.getState());
    // await job.remove();
  }
}

main()
  .then(() => console.log("removed jobs"))
  .catch(console.error)
  .finally(() => {
    process.exit();
  });
