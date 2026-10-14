import { Queue, QueueEvents } from "bullmq";

import {
  BuildJobPayloadType,
  RedeploymentJobPayloadType,
} from "../../src/types";

const queueRedisOptions = { host: "localhost", port: 6379 };

const buildJobOptions = {
  connection: queueRedisOptions,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    attempts: 0,
  },
};

const buildQueue = new Queue<BuildJobPayloadType>("buildQueue", buildJobOptions);

const buildQueueEvents = new QueueEvents("buildQueue", {
  connection: queueRedisOptions,
});

// Second build lane: Android jobs go here while the lane is switched on, so an
// Android and an iOS build can run at the same time (the worker runs one job
// per queue). Off, every job goes to buildQueue as before; jobs already in
// this queue still finish.
const ANDROID_BUILD_QUEUE = "androidBuildQueue";

const androidBuildQueue = new Queue<BuildJobPayloadType>(
  ANDROID_BUILD_QUEUE,
  buildJobOptions,
);

const androidBuildQueueEvents = new QueueEvents(ANDROID_BUILD_QUEUE, {
  connection: queueRedisOptions,
});

/** Redis key behind `node scripts/queue.js lanes on|off` */
const ANDROID_LANE_KEY = "wl:android-lane";

/** where a new build job for this platform goes; read on every add, so the switch needs no restart */
const buildQueueFor = async (platform: "android" | "ios") => {
  if (platform !== "android") return buildQueue;
  const client = await buildQueue.client;
  return (await client.get(ANDROID_LANE_KEY)) === "1" ? androidBuildQueue : buildQueue;
};

/** a build job by its id (= deployment id) in whichever lane it was queued */
const findBuildJob = async (jobId: string) =>
  (await buildQueue.getJob(jobId)) ?? (await androidBuildQueue.getJob(jobId));

/** progress/completed events from both lanes */
const allBuildQueueEvents = [buildQueueEvents, androidBuildQueueEvents];

const redeploymentQueue = new Queue<RedeploymentJobPayloadType>(
  "redeploymentQueue",
  {
    connection: queueRedisOptions,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 0,
    },
  },
);

const redeploymentQueueEvents = new QueueEvents("redeploymentQueue", {
  connection: queueRedisOptions,
});

export {
  ANDROID_BUILD_QUEUE,
  ANDROID_LANE_KEY,
  allBuildQueueEvents,
  androidBuildQueue,
  buildQueue,
  buildQueueEvents,
  buildQueueFor,
  findBuildJob,
  queueRedisOptions,
  redeploymentQueue,
  redeploymentQueueEvents,
};
