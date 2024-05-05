import { Worker } from "bullmq";
import { exec } from "child_process";
import mongoose from "mongoose";
import CustomHostModel from "src/models/customHost.model";
import DeploymentModel from "src/models/deployment.model";
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

    const taskId = uuid(); // creating a unique id for the task
    const e = exec(`node ./src/scripts/random-output ${job.name}`, {
      cwd: process.cwd(),
    });
    const { stdout, stderr } = e;

    if (stdout) {
      stdout.on("data", (data) => {
        console.log(data);
        // updating the progress of the job so i can listen to the progress of the job through queue events
        // can be listen using queue events on progress listener
        job.updateProgress({
          taskId,
          message: data,
          timestamp: Date.now(),
        } as JobProgressType);
      });
    }
    if (stderr) {
      stderr.on("data", (data) => {
        console.error(data);
        // updating the progress of the job so i can listen to the progress of the job through queue events
        job.updateProgress({
          taskId,
          message: data,
          timestamp: Date.now(),
        } as JobProgressType);
      });
    }

    const code = await new Promise((resolve, reject) => {
      e.on("close", resolve);
      e.on("error", reject);
    });

    //**
    //** Post Deployment Updated and steps
    //** 2. Update the deployment status based on the code
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
      if (code === 0) {
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
      } else {
        deployment.status = "failed";
      }
      await deployment.save();
      await customhost.save();

      console.log(
        `Deployment ${deploymentId} status updated to ${deployment.status}`,
      );
    } catch (error) {
      console.error("Error updating deployment status:", error);
    }

    console.log(`Job ${job.name} completed with code ${code}`);
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
