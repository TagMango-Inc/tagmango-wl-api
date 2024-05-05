import { Job, Worker } from "bullmq";
import { exec } from "child_process";
import databaseConntect from "src/utils/database";
import { v4 as uuid } from "uuid";

import { BuildJobPayloadType, JobProgressType } from "../types";
import { queueRedisOptions } from "./config";

const worker = new Worker<BuildJobPayloadType>(
  "buildQueue",
  async (job) => {
    const {
      deploymentId,
      hostId,
      platform,
      name,
      bundle,
      domain,
      color,
      bgColor,
      onesignal_id,
    } = job.data;

    console.log(
      `Processing job ${job.name}`,
      JSON.stringify(job.data, null, 2),
    );

    const rootBranch = "test-build-m1"; // will be updated to the actual branch name (main)
    const githubrepo = "TagMangoApp";
    const formatedAppName = name.replace(/ /g, "");
    const customhostDeploymentDir = "deployments";

    try {
      // Pre Deployment Steps
      // step: 1: Fetching lastest changes to root TagMango project ( for testing fetching lastest changes from test-build-m1)

      await executeTask(
        [
          `cd root/${githubrepo}`,
          `git checkout ${rootBranch}`,
          `git pull origin ${rootBranch}`,
        ],
        `Fetching latest changes from origin ${rootBranch}`,
        job,
      );

      // step: 2: Copying the lastest root project to deployment/{bundleId} folder

      await executeTask(
        [
          `mkdir -p ${customhostDeploymentDir}/${bundle}`,
          `cp -r root/${githubrepo} ${customhostDeploymentDir}/${bundle}`,
        ],
        `Copying root project to ${customhostDeploymentDir}/${bundle}`,
        job,
      );

      // step: 3 : Creating the WLApps/{formatedName} folder in the deployment/{bundleId} folder

      await executeTask(
        [`mkdir -p ${customhostDeploymentDir}/${bundle}/${githubrepo}/WLApps`],
        `Creating WLApps/${formatedAppName} folder in ${customhostDeploymentDir}/${bundle}`,
        job,
      );

      // step: 4: Copying the WL assets from WLApps/{formatedName} to deployment/{bundleId}/WLApps/{formatedName}

      await executeTask(
        [
          `cp -r WLApps/${formatedAppName} ${customhostDeploymentDir}/${bundle}/${githubrepo}/WLApps/${formatedAppName}`,
        ],
        `Copying WLApps/${bundle} to ${customhostDeploymentDir}/${bundle}/WLApps/${bundle}`,
        job,
      );

      // step: 4: Running the pre deployment and bundle script for the deployment/{bundleId} folder

      await executeTask(
        [
          `cd ${customhostDeploymentDir}/${bundle}/${githubrepo}`,
          `npm install`,
          `node ./scripts/app-build.js ${JSON.stringify({ name, bundle, domain, color, bgColor, onesignal_id })}`,
        ],
        `Running pre deployment and bundle script`,
        job,
      );

      // Deployment Steps
    } catch (error) {}

    // //**
    // //** Post Deployment Updated and steps
    // //** 2. Update the deployment status based on the code
    // try {
    //   const deployment = await DeploymentModel.findById(deploymentId);
    //   const customhost = await CustomHostModel.findById(hostId);
    //   if (!deployment) {
    //     console.log(`Deployment with ID ${deploymentId} not found`);
    //     return;
    //   }
    //   if (!customhost) {
    //     console.log(`Custom host with ID ${hostId} not found`);
    //     return;
    //   }
    //   // for deployment success then update the status to success
    //   // and updating last deployment details for custom host
    //   if (code === 0) {
    //     deployment.status = "success";
    //     await CustomHostModel.updateOne(
    //       { _id: new mongoose.Types.ObjectId(hostId) },
    //       [
    //         platform === "android"
    //           ? {
    //               $set: {
    //                 "androidDeploymentDetails.buildNumber":
    //                   "$androidDeploymentDetails.lastDeploymentDetails.buildNumber",
    //                 "androidDeploymentDetails.versionName":
    //                   "$androidDeploymentDetails.lastDeploymentDetails.versionName",
    //               },
    //             }
    //           : {
    //               $set: {
    //                 "iosDeploymentDetails.buildNumber":
    //                   "$iosDeploymentDetails.lastDeploymentDetails.buildNumber",
    //                 "iosDeploymentDetails.versionName":
    //                   "$iosDeploymentDetails.lastDeploymentDetails.versionName",
    //               },
    //             },
    //       ],
    //     );
    //   } else {
    //     deployment.status = "failed";
    //   }
    //   await deployment.save();
    //   await customhost.save();

    //   console.log(
    //     `Deployment ${deploymentId} status updated to ${deployment.status}`,
    //   );
    // } catch (error) {
    //   console.error("Error updating deployment status:", error);
    // }

    // console.log(`Job ${job.name} completed with code ${code}`);
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

(async () => {
  await databaseConntect();
})();

const executeTask = async (
  commands: string[],
  taskName: string = "",
  job: Job<BuildJobPayloadType, any, string>,
) => {
  console.log(
    ` ************** Executing task  [ ${taskName} ] ************** `,
  );

  const taskId = uuid(); // creating a unique id for the task
  const e = exec(commands.join(" && "), {
    cwd: process.cwd(),
  });
  const { stdout, stderr } = e;

  if (stdout) {
    stdout.on("data", (data) => {
      console.log(data);
      // updating the progress of the job so i can listen to the progress of the job through queue events
      // can be listen using queue events on progress listener
      job.updateProgress({
        task: {
          id: taskId,
          name: taskName,
        },
        message: data,
        timestamp: Date.now(),
      } as JobProgressType);
    });
  }
  if (stderr) {
    stderr.on("data", (data) => {
      console.error(data);
      // updating the progress of the job so i can listen to the progress of the job through queue events
      // can be listen using queue events on progress listener
      job.updateProgress({
        task: {
          id: taskId,
          name: taskName,
        },
        message: data,
        timestamp: Date.now(),
      } as JobProgressType);
    });
  }

  const code = await new Promise((resolve, reject) => {
    e.on("close", resolve);
    e.on("error", reject);
  });

  if (code !== 0) {
    console.error(`Failed to execute task [ ${taskName} ]`);
    throw new Error(`Failed to execute task [ ${taskName} ]`);
  }

  return code;
};
