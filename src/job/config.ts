import { Queue, QueueEvents } from "bullmq";

import {
  BuildJobPayloadType,
  RedeploymentJobPayloadType,
} from "../../src/types";

const queueRedisOptions = { host: "localhost", port: 6379 };

const buildQueue = new Queue<BuildJobPayloadType>("buildQueue", {
  connection: queueRedisOptions,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    attempts: 0,
  },
});

const buildQueueEvents = new QueueEvents("buildQueue", {
  connection: queueRedisOptions,
});

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
  buildQueue,
  buildQueueEvents,
  queueRedisOptions,
  redeploymentQueue,
  redeploymentQueueEvents,
};
