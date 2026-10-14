import { v4 as uuid } from "uuid";

import { IDeploymentTask } from "../../src/types/database";
import { customhostDeploymentDir } from "../constants";

export function generateTaskNames({
  bundle,
  formatedAppName,
  platform,
  appGroupsEnabled,
}: {
  bundle: string;
  formatedAppName: string;
  platform: "android" | "ios";
  /** iOS only; names the pipeline in task 6 */
  appGroupsEnabled?: boolean;
}) {
  const tasks = [
    `Fetching latest changes from root branch`,
    `Copying root project to ${customhostDeploymentDir}/${bundle} directory`,
    `Generating assets for android and ios and Copying to ${customhostDeploymentDir}/${bundle}/assets`,
    `Generating screenshots`,
    `Generating metadata files for android and ios`,
    `Running pre deployment and bundle script`,
    platform === "ios" && appGroupsEnabled !== undefined
      ? appGroupsEnabled
        ? `Generating app and App Group on platform via fastlane`
        : `Generating app on platform via fastlane (no App Group)`
      : `Generating app on platform via fastlane`,
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
  appGroupsEnabled,
}: {
  bundle: string;
  formatedAppName: string;
  platform: "android" | "ios";
  appGroupsEnabled?: boolean;
}) {
  const taskNames = generateTaskNames({
    bundle,
    platform,
    formatedAppName,
    appGroupsEnabled,
  });
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
