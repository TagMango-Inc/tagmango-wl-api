import { createFactory } from "hono/factory";
import { streamSSE } from "hono/streaming";

import { buildQueueEvents } from "../../src/job/config";
import { JobProgressType } from "../../src/types";

const factory = createFactory();

/**
 * Both streams previously:
 *  - attached `progress`/`completed` listeners per request and never removed
 *    them (EventEmitter leak + stale closures writing to closed streams),
 *  - ran a Redis round trip (Job.fromId) per progress event to identify the
 *    deployment (the payload now carries deploymentId),
 *  - closed the stream when ANY other deployment emitted, and resolved on
 *    ANY job completing.
 */

const getDeploymentTaskStatusSSE = factory.createHandlers(async (c) => {
  const { deploymentId: watchedDeploymentId } = c.req.param();

  return streamSSE(c, async (stream) => {
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const onProgress = async (job: { jobId: string; data: unknown }) => {
      const progress = job.data as JobProgressType;
      if (progress?.deploymentId !== watchedDeploymentId) return;

      const { task } = progress;
      await stream.writeSSE({
        data: `${JSON.stringify({
          id: task.id,
          type: task.type,
          name: task.name,
          duration: task.duration,
        })}`,
      });
    };

    const onCompleted = ({ jobId }: { jobId: string }) => {
      // deterministic job ids: jobId === deploymentId
      if (jobId === watchedDeploymentId) {
        finish();
      }
    };

    buildQueueEvents.on("progress", onProgress);
    buildQueueEvents.on("completed", onCompleted);
    stream.onAbort(finish);

    try {
      await done;
    } finally {
      buildQueueEvents.off("progress", onProgress);
      buildQueueEvents.off("completed", onCompleted);
    }
  });
});

const getDeploymentTaskLogsSSE = factory.createHandlers(async (c) => {
  const { deploymentId: watchedDeploymentId, taskId: watchedTaskId } =
    c.req.param();

  return streamSSE(c, async (stream) => {
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const onProgress = async (job: { jobId: string; data: unknown }) => {
      const progress = job.data as JobProgressType;
      if (
        progress?.deploymentId !== watchedDeploymentId ||
        progress?.task?.id !== watchedTaskId
      ) {
        return;
      }

      await stream.writeSSE({
        data: `${JSON.stringify({
          message: progress.message,
          type: progress.type,
          timestamp: progress.timestamp,
        })}`,
      });
    };

    const onCompleted = ({ jobId }: { jobId: string }) => {
      if (jobId === watchedDeploymentId) {
        finish();
      }
    };

    buildQueueEvents.on("progress", onProgress);
    buildQueueEvents.on("completed", onCompleted);
    stream.onAbort(finish);

    try {
      await done;
    } finally {
      buildQueueEvents.off("progress", onProgress);
      buildQueueEvents.off("completed", onCompleted);
    }
  });
});

export { getDeploymentTaskLogsSSE, getDeploymentTaskStatusSSE };
