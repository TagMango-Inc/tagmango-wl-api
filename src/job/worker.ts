import { Job, Worker } from "bullmq";
import { exec } from "child_process";
import mongoose from "mongoose";
import CustomHostModel from "src/models/customHost.model";
import DeploymentModel, {
  IDeploymentTaskType,
} from "src/models/deployment.model";
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
      // Changing deployment status to processing from pending

      await DeploymentModel.findByIdAndUpdate(deploymentId, {
        status: "processing",
      });

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
        deploymentId,
      );

      // step: 2: Copying the lastest root project to deployment/{bundleId} folder

      await executeTask(
        [
          `mkdir -p ${customhostDeploymentDir}/${bundle}`,
          `cp -r root/${githubrepo} ${customhostDeploymentDir}/${bundle}`,
        ],
        `Copying root project to ${customhostDeploymentDir}/${bundle}`,
        job,
        deploymentId,
      );

      // step: 3 : Creating the WLApps/{formatedName} folder in the deployment/{bundleId} folder

      await executeTask(
        [`mkdir -p ${customhostDeploymentDir}/${bundle}/${githubrepo}/WLApps`],
        `Creating WLApps/${formatedAppName} folder in ${customhostDeploymentDir}/${bundle}`,
        job,
        deploymentId,
      );

      // step: 4: Copying the WL assets from WLApps/{formatedName} to deployment/{bundleId}/WLApps/{formatedName}

      await executeTask(
        [
          `cp -r WLApps/${formatedAppName} ${customhostDeploymentDir}/${bundle}/${githubrepo}/WLApps/${formatedAppName}`,
        ],
        `Copying WLApps/${bundle} to ${customhostDeploymentDir}/${bundle}/WLApps/${bundle}`,
        job,
        deploymentId,
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
        deploymentId,
      );

      // step 5: Running the fastlane build for specific targer platform
      await executeTask(
        [
          `cd ${customhostDeploymentDir}/${bundle}/${githubrepo}`,
          `fastlane ${platform} build`,
        ],
        "Running the fastlane build for specific targer platform",
        job,
        deploymentId,
      );

      // step 5: Running the fastlane deployment

      // step 6: Removing the deployment/{bundleId} folder after successful deployment
      await executeTask(
        [`rm -rf ${customhostDeploymentDir}/${bundle}`],
        `Removing the ${customhostDeploymentDir}/${bundle} folder`,
        job,
        deploymentId,
      );

      // updating the version details for the target platform after successful deployment
      await updateVersionDetails({ deploymentId, hostId, platform });
    } catch (error) {
      // if we are getting any erro (throw error) then we need to remove the deployment/{bundleId} folder
      await executeTask(
        [`rm -rf ${customhostDeploymentDir}/${bundle}`],
        `Removing the ${customhostDeploymentDir}/${bundle} folder`,
        job,
        deploymentId,
      );

      // updating the deployment status to failed
      await DeploymentModel.findByIdAndUpdate(deploymentId, {
        status: "failed",
      });
    }
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
  deploymentId: string,
) => {
  console.log(
    ` ************** Executing task  [ ${taskName} ] ************** `,
  );

  const taskId = uuid(); // creating a unique id for the task

  // sending job progress to sse
  job.updateProgress({
    task: {
      id: taskId,
      name: taskName,
    },
    type: "initialized",
    message: `Initialized task [ ${taskName} ]`,
    timestamp: Date.now(),
  } as JobProgressType);

  const e = exec(commands.join(" && "), {
    cwd: process.cwd(),
  });
  const { stdout, stderr } = e;

  let outputLogs: Pick<IDeploymentTaskType, "logs">["logs"] = [];
  let errorLogs: Pick<IDeploymentTaskType, "logs">["logs"] = [];

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
        type: "success",
        timestamp: Date.now(),
      } as JobProgressType);

      // adding logs to the task
      outputLogs.push({
        message: data,
        type: "success",
        timestamp: new Date(),
      });
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
        type: "success",
        timestamp: Date.now(),
      } as JobProgressType);

      // adding logs to the task
      errorLogs.push({
        message: data,
        type: "failed",
        timestamp: new Date(),
      });
    });
  }

  const code = await new Promise((resolve, reject) => {
    e.on("close", resolve);
    e.on("error", reject);
  });

  let task: IDeploymentTaskType = {
    id: taskId,
    name: taskName,
    status: "processing",
    logs: [],
  };

  if (code === 0) {
    // add task to database and no logs should be there

    task.status = "success";
    task.logs = outputLogs;

    job.updateProgress({
      task: {
        id: taskId,
        name: taskName,
      },
      message: `Task [ ${taskName} ] executed successfully`,
      type: "success",
      timestamp: Date.now(),
    } as JobProgressType);
  } else {
    // add logs to the task and update the status to failed

    task.status = "failed";
    task.logs = errorLogs;

    job.updateProgress({
      task: {
        id: taskId,
        name: taskName,
      },
      message: `Failed to execute task [ ${taskName} ]`,
      type: "failed",
      timestamp: Date.now(),
    } as JobProgressType);

    console.error(`Failed to execute task [ ${taskName} ]`);
  }

  await DeploymentModel.findByIdAndUpdate(deploymentId, {
    $push: {
      tasks: task,
    },
  });

  if (task.status === "failed") {
    throw new Error(`Failed to execute task [ ${taskName} ]`);
  }

  return code;
};

const updateVersionDetails = async ({
  deploymentId,
  hostId,
  platform,
}: {
  deploymentId: string;
  hostId: string;
  platform: "android" | "ios";
}) => {
  try {
    const deployment = await DeploymentModel.findById(deploymentId);
    const customhost = await CustomHostModel.findById(hostId);
    if (!deployment) {
      console.log(`Deployment with ID ${deploymentId} not found`);
      return;
    }
    if (!customhost) {
      console.log(`Custom host with ID ${hostId} not found`);
      return;
    }
    // for deployment success then update the status to success
    // and updating last deployment details for custom host

    deployment.status = "success";
    await CustomHostModel.updateOne(
      { _id: new mongoose.Types.ObjectId(hostId) },
      [
        platform === "android"
          ? {
              $set: {
                "androidDeploymentDetails.buildNumber":
                  "$androidDeploymentDetails.lastDeploymentDetails.buildNumber",
                "androidDeploymentDetails.versionName":
                  "$androidDeploymentDetails.lastDeploymentDetails.versionName",
              },
            }
          : {
              $set: {
                "iosDeploymentDetails.buildNumber":
                  "$iosDeploymentDetails.lastDeploymentDetails.buildNumber",
                "iosDeploymentDetails.versionName":
                  "$iosDeploymentDetails.lastDeploymentDetails.versionName",
              },
            },
      ],
    );

    await deployment.save();
    await customhost.save();
    console.log(
      `Deployment ${deploymentId} status updated to ${deployment.status}`,
    );
  } catch (error) {
    console.error("Error updating deployment status:", error);
  }
};
