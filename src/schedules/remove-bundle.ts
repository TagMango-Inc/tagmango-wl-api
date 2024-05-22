import { exec } from "child_process";
import fs from "fs-extra";
import cron from "node-cron";
import util from "util";

import { DAY_FROM_NOW, REMOVE_BUNDLES_CRON } from "../constants";
import { AABDetailsType } from "../types";

const execAsync = util.promisify(exec);

const { readFile, writeFile } = fs.promises;
cron.schedule(REMOVE_BUNDLES_CRON, async () => {
  const date = new Date();
  date.setDate(date.getDate() - DAY_FROM_NOW);
  const updatedDate = date;

  console.log("Running remove-bundle schedule");

  const rawAABDetails = await readFile("./data/android-aab.json", "utf-8");
  const parsedDetails: AABDetailsType = JSON.parse(rawAABDetails);

  const updatedDetails = Object.keys(parsedDetails).reduce((acc, key) => {
    if (new Date(parsedDetails[key].createdAt) < updatedDate) {
      return acc;
    }
    return { ...acc, [key]: parsedDetails[key] };
  }, {} as AABDetailsType);

  await writeFile(
    "./data/android-aab.json",
    JSON.stringify(updatedDetails, null, 2),
  );

  for await (const key of Object.keys(parsedDetails)) {
    if (new Date(parsedDetails[key].createdAt) < updatedDate) {
      await execAsync(`rm -rf ./outputs/android/${key}.aab`);
    }
  }

  console.log(
    `Removed ${Object.keys(parsedDetails).length - Object.keys(updatedDetails).length} bundles`,
  );
});
