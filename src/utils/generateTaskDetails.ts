import { v4 as uuid } from "uuid";

import { customhostDeploymentDir, rootBranch } from "../constants";

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
    `Fetching latest changes from origin ${rootBranch}`,
    `Copying root project to ${customhostDeploymentDir}/${bundle} directory`,
    // `Copying WLApps/${formatedAppName} to ${customhostDeploymentDir}/${bundle}/WLApps/${formatedAppName}`,
    `Generating assets for android and ios and Copying to ${customhostDeploymentDir}/${bundle}/assets`,
    `Running pre deployment and bundle script`,
    `Running fastlane bundle for ${platform} platform`,
    `Running fastlane deploy for ${platform} platform`,
    // `Deploying the project`,
    // `Pushing changes to the Repository Branch`,
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
    };
  });
  return generatedTasks;
}
