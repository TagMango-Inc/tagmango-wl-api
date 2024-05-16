// const ROOT_BRANCH = "main"; // will be updated to the actual branch name (main)
const githubrepo = "TagMangoApp";
const customhostDeploymentDir = "deployments";

const CURRENT_VERSION_NAME = "3.1.6";
const CURRENT_VERSION_NUMBER = 600;
const ROOT_BRANCH = `v/${CURRENT_VERSION_NAME}`;

const RECURRING_JOB = "0 0 * * SUN";

const DEPLOYMENT_REQUIREMENTS = [
  "Update metadata app name",
  "Upload metadata app logo",
  "Update Onesignal app id",
  "Enable In-app purchase from the app settings",
];

export {
  CURRENT_VERSION_NAME,
  CURRENT_VERSION_NUMBER,
  customhostDeploymentDir,
  DEPLOYMENT_REQUIREMENTS,
  githubrepo,
  RECURRING_JOB,
  ROOT_BRANCH,
};
