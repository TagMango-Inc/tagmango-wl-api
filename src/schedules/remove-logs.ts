import cron from "node-cron";

import { DAY_FROM_NOW, REMOVE_SUCCESS_LOGS_CRON } from "../constants";
import Mongo from "../database";

const runSchedule = async () => {
  const date = new Date();

  date.setDate(date.getDate() - DAY_FROM_NOW);
  const updatedDate = date;

  // clear logs in-place — no need to load full docs (incl. all logs) into
  // memory and write whole task arrays back
  const resp = await Mongo.deployment.updateMany(
    {
      updatedAt: { $lt: updatedDate },
      status: "success",
    },
    { $set: { "tasks.$[].logs": [] } },
  );

  console.log(
    `Logs removed for ${resp.modifiedCount} deployments on ${new Date()} before ${updatedDate}`,
  );
};

Mongo.connect().then(() => {
  cron.schedule(REMOVE_SUCCESS_LOGS_CRON, async () => {
    await runSchedule();
  });
});
