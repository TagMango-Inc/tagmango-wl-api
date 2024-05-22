import cron from "node-cron";

import { DAY_FROM_NOW, REMOVE_SUCCESS_LOGS_CRON } from "../constants";
import Mongo from "../database";

const runSchedule = async () => {
  const date = new Date();

  date.setDate(date.getDate() - DAY_FROM_NOW);
  const updatedDate = date;

  const deploymentsToUpdate = await Mongo.deployment
    .find({
      updatedAt: { $lt: updatedDate },
      status: "success",
    })
    .toArray();

  const updatedDocuments = deploymentsToUpdate.map((doc) => {
    const updatedTasks = doc.tasks.map((task) => ({ ...task, logs: [] }));
    return { ...doc, tasks: updatedTasks };
  });

  const bulkWriteOps = updatedDocuments.map((doc) => ({
    updateOne: {
      filter: { _id: doc._id },
      update: { $set: { tasks: doc.tasks } },
    },
  }));

  const resp = await Mongo.deployment.bulkWrite(bulkWriteOps);

  console.log(
    `Logs removed for ${resp.modifiedCount} deployments on ${new Date()} before ${updatedDate}`,
  );
};

Mongo.connect().then(() => {
  cron.schedule(REMOVE_SUCCESS_LOGS_CRON, async () => {
    await runSchedule();
  });
});
