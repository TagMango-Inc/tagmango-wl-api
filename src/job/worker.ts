import { Job, Worker } from "bullmq";
import { exec } from "child_process";
import mongoose from "mongoose";
import CustomHostModel from "src/models/customHost.model";
import DeploymentModel, { IDeploymentTask } from "src/models/deployment.model";
import databaseConntect from "src/utils/database";

import { customhostDeploymentDir, githubrepo, rootBranch } from "../constants";
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

    const formatedAppName = name.replace(/ /g, "");

    /**
     * Fetching the task names for the deployment
     */
    const results = await DeploymentModel.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(deploymentId),
        },
      },
      {
        $project: {
          _id: 0,
          taskNames: {
            $map: {
              input: "$tasks",
              as: "task",
              in: {
                id: "$$task.id",
                name: "$$task.name",
              },
            },
          },
        },
      },
    ]);

    const { taskNames } = results[0] as {
      taskNames: {
        id: string;
        name: string;
      }[];
    };

    /**
     * Combining commands with their respective task names and is
     */

    const commands = {
      // step: 1: Fetching lastest changes to root TagMango project ( for testing fetching lastest changes from test-build-m1)
      [taskNames[0].id]: [
        `cd root/${githubrepo}`,
        `git checkout ${rootBranch}`,
        `git pull origin ${rootBranch}`,
      ],
      // step: 2: Copying the lastest root project to deployment/{bundleId} folder
      [taskNames[1].id]: [
        `mkdir -p ${customhostDeploymentDir}/${bundle}`,
        `cp -r root/${githubrepo} ${customhostDeploymentDir}/${bundle}`,
      ],
      // step: 3: Copying the WL assets from WLApps/{formatedName} to deployment/{bundleId}/WLApps/{formatedName}
      [taskNames[2].id]: [
        `mkdir -p ${customhostDeploymentDir}/${bundle}/${githubrepo}/WLApps`,
        `cp -r WLApps/${formatedAppName} ${customhostDeploymentDir}/${bundle}/${githubrepo}/WLApps/${formatedAppName}`,
      ],
      // step: 4: Running the pre deployment and bundle script for the deployment/{bundleId} folder
      [taskNames[3].id]: [
        `cd ${customhostDeploymentDir}/${bundle}/${githubrepo}`,
        `npm install`,
        `node ./scripts/app-build.js ${JSON.stringify({ name, bundle, domain, color, bgColor, onesignal_id })}`,
      ],
      // step 5: Running the fastlane build for specific targer platform
      [taskNames[4].id]: [
        `cd ${customhostDeploymentDir}/${bundle}/${githubrepo}`,
        `fastlane ${platform} build`,
      ],
      // step 6: Removing the deployment/{bundleId} folder after successful deployment
      [taskNames[5].id]: [`rm -rf ${customhostDeploymentDir}/${bundle}`],
    };

    console.log(
      ` ---------------------------------------- Initiated Deployment Process ---------------------------------------- `,
    );

    try {
      // Changing deployment status to processing from pending
      await DeploymentModel.findByIdAndUpdate(deploymentId, {
        status: "processing",
      });

      // executing the tasks
      for (const task of taskNames) {
        await executeTask({
          commands: commands[task.id],
          taskId: task.id,
          taskName: task.name,
          job,
          deploymentId,
        });
      }

      // updating the version details for the target platform after successful deployment
      await updateVersionDetails({ deploymentId, hostId, platform });
    } catch (error) {
      // if we are getting any erro (throw error) then we need to remove the deployment/{bundleId} folder
      const task = taskNames.slice(-1)[0];
      await executeTask({
        commands: commands[task.id],
        taskId: task.id,
        taskName: task.name,
        job,
        deploymentId,
      });
      // updating the deployment status to failed
      await DeploymentModel.findByIdAndUpdate(deploymentId, {
        status: "failed",
      });
    }
    console.log(
      ` ---------------------------------------- Completed Deployment Process ---------------------------------------- `,
    );
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

const executeTask = async ({
  commands,
  taskId,
  taskName,
  job,
  deploymentId,
}: {
  commands: string[];
  taskId: string;
  taskName: string;
  job: Job<BuildJobPayloadType, any, string>;
  deploymentId: string;
}) => {
  console.log(
    ` ************** Executing task  [ ${taskName} ] ************** `,
  );

  // sending job progress to sse
  job.updateProgress({
    task: {
      id: taskId,
      name: taskName,
      type: "initialised",
      duration: 0,
    },
    type: "success",
    message: `Initialized task [ ${taskName} ]`,
    timestamp: new Date(),
  } as JobProgressType);

  // updating task status to processing
  await DeploymentModel.updateOne(
    {
      _id: new mongoose.Types.ObjectId(deploymentId),
      "tasks.id": taskId,
    },
    {
      $set: {
        "tasks.$.status": "processing",
      },
    },
  );

  // started executing the task
  const e = exec(commands.join(" && "), {
    cwd: process.cwd(),
  });
  const { stdout, stderr } = e;
  // start time of the task
  const startTime = Date.now();

  let outputLogs: Pick<IDeploymentTask, "logs">["logs"] = [];
  let errorLogs: Pick<IDeploymentTask, "logs">["logs"] = [];

  if (stdout) {
    stdout.on("data", (data) => {
      console.log(data);
      // updating the progress of the job so i can listen to the progress of the job through queue events
      // can be listen using queue events on progress listener
      job.updateProgress({
        task: {
          id: taskId,
          name: taskName,
          type: "processing",
          duration: Date.now() - startTime,
        },
        type: "success",
        message: data,
        timestamp: new Date(),
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
      const warningRegex = /\b(?:warn(?:ing)?|deprecated)\b/i;
      console.error(data);
      // updating the progress of the job so i can listen to the progress of the job through queue events
      // can be listen using queue events on progress listener
      job.updateProgress({
        task: {
          id: taskId,
          name: taskName,
          type: "processing",
          duration: Date.now() - startTime,
        },
        type: warningRegex.test(data) ? "warning" : "failed",
        message: data,
        timestamp: new Date(),
      } as JobProgressType);

      // adding logs to the task
      errorLogs.push({
        message: data,
        type: "failed",
        timestamp: new Date(),
      });
    });
  }

  // waiting for the task to complete
  // if the task is completed then we will get the code
  const code = await new Promise((resolve, reject) => {
    e.on("close", resolve);
    e.on("error", reject);
  });

  // if the code is 0 then the task is completed successfully
  if (code === 0) {
    // sending job progress to sse
    job.updateProgress({
      task: {
        id: taskId,
        name: taskName,
        type: "success",
        duration: Date.now() - startTime,
      },
      type: "success",
      message: `Task [ ${taskName} ] executed successfully`,
      timestamp: new Date(),
    } as JobProgressType);

    // update the task status to success and add logs to the task
    await DeploymentModel.updateOne(
      {
        _id: new mongoose.Types.ObjectId(deploymentId),
        "tasks.id": taskId,
      },
      {
        $set: {
          "tasks.$.status": "success",
          "tasks.$.logs": outputLogs,
          "tasks.$.duration": Date.now() - startTime,
        },
      },
    );
  } else {
    // add logs to the task and update the status to failed
    job.updateProgress({
      task: {
        id: taskId,
        name: taskName,
        type: "failed",
        duration: Date.now() - startTime,
      },
      type: "failed",
      message: `Failed to execute task [ ${taskName} ]`,
      timestamp: new Date(),
    } as JobProgressType);

    // update the task status to failed and add logs to the task
    await DeploymentModel.updateOne(
      {
        _id: new mongoose.Types.ObjectId(deploymentId),
        "tasks.id": taskId,
      },
      {
        $set: {
          "tasks.$.status": "failed",
          "tasks.$.logs": errorLogs,
          "tasks.$.duration": Date.now() - startTime,
        },
      },
    );

    console.error(`Failed to execute task [ ${taskName} ]`);
  }

  // after all updates (success or failed) are done in the database then we can return error
  if (code !== 0) {
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
