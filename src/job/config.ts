import { Queue } from "bullmq";

const queueRedisOptions = { host: "localhost", port: 6379 };

const builQueue = new Queue("buildQueue", {
  connection: queueRedisOptions,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    attempts: 0,
  },
});

export { builQueue, queueRedisOptions };
