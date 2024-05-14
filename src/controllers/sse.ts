import { Job } from "bullmq";
import { createFactory } from "hono/factory";
import { SSEStreamingApi, streamSSE } from "hono/streaming";

import { buildQueue, buildQueueEvents } from "../../src/job/config";
import { JobProgressType } from "../../src/types";

const factory = createFactory();

const getDeploymentTaskStatusSSE = factory.createHandlers(async (c) => {
  const { deploymentId: deploymentIdFromParam } = c.req.param();

  const jobCompletePromise = async (stream: SSEStreamingApi) => {
    return new Promise<void>((resolve) => {
      buildQueueEvents.on("completed", async (job) => {
        console.log(`Job ${job.jobId} completed`, JSON.stringify(job, null, 2));
        if (job.jobId) {
          resolve();
        }
      });
    });
  };

  return streamSSE(c, async (stream) => {
    buildQueueEvents.on("progress", async (job) => {
      const jobDetails = await Job.fromId(buildQueue, job.jobId);

      if (!jobDetails) return;

      const jobName = jobDetails.name;

      const [deploymentId, targetPlatform, lastDeploymentVersionName] =
        jobName.split("-");

      if (deploymentId === deploymentIdFromParam) {
        const { task } = job.data as JobProgressType;
        const message = {
          data: `${JSON.stringify({
            id: task.id,
            type: task.type,
            name: task.name,
            duration: task.duration,
          })}`,
        };
        await stream.writeSSE(message);
      } else {
        stream.close();
      }
    });

    await jobCompletePromise(stream);
  });
});

const getDeploymentTaskLogsSSE = factory.createHandlers(async (c) => {
  const { deploymentId: deploymentIdFromParam, taskId: taskIdFromParam } =
    c.req.param();

  const jobCompletePromise = new Promise<void>((resolve) => {
    // Set up event listener for job completion
    buildQueueEvents.on("completed", async (job) => {
      console.log(`Job ${job.jobId} completed`, JSON.stringify(job, null, 2));
      if (job.jobId) {
        // Assuming jobId is set elsewhere
        resolve();
      }
    });
  });

  return streamSSE(c, async (stream) => {
    // listen to the progress of the job (set by job.updateProgress() in worker.ts
    buildQueueEvents.on("progress", async (job) => {
      const jobDetails = await Job.fromId(buildQueue, job.jobId);

      if (!jobDetails) return;

      const jobName = jobDetails.name;

      const [deploymentId, targetPlatform] = jobName.split("-");

      const {
        task,
        message: logMessage,
        timestamp,
        type,
      } = job.data as JobProgressType;

      if (
        deploymentId === deploymentIdFromParam &&
        task.id === taskIdFromParam
      ) {
        const message = {
          data: `${JSON.stringify({
            message: logMessage,
            type,
            timestamp,
          })}`,
        };
        await stream.writeSSE(message);
      } else {
        stream.close();
      }
    });

    // Wait for job to complete before closing the stream
    await jobCompletePromise;
  });
});

export { getDeploymentTaskLogsSSE, getDeploymentTaskStatusSSE };
