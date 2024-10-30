import { v4 as uuid } from "uuid";

import { IDeploymentTask } from "../../src/types/database";
import { customhostDeploymentDir } from "../constants";

export function generateTaskNames({
  bundle,
  formatedAppName,
  platform,
}: {
  bundle: string;
  formatedAppName: string;
  platform: "android" | "ios";
}) {
  const tasks = [
    `Fetching latest changes from root branch`,
    `Copying root project to ${customhostDeploymentDir}/${bundle} directory`,
    `Generating assets for android and ios and Copying to ${customhostDeploymentDir}/${bundle}/assets`,
    `Generating screenshots`,
    `Generating metadata files for android and ios`,
    `Running pre deployment and bundle script`,
    `Generating app on platform via fastlane`,
    `Running fastlane bundle for ${platform} platform`,
    `Running fastlane deploy for ${platform} platform`,
    `Removing the ${customhostDeploymentDir}/${bundle} folder`,
  ];

  return tasks;
}

export function generateDeploymentTasks({
  bundle,
  formatedAppName,
  platform,
}: {
  bundle: string;
  formatedAppName: string;
  platform: "android" | "ios";
}) {
  const taskNames = generateTaskNames({ bundle, platform, formatedAppName });
  const generatedTasks = taskNames.map((name) => {
    return {
      id: uuid(),
      name,
      status: "pending",
      logs: [],
      duration: 0,
    } as IDeploymentTask;
  });
  return generatedTasks;
}
