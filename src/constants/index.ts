const githubrepo = "TagMangoApp";
const customhostDeploymentDir = "deployments";

const DEPLOYMENT_REQUIREMENTS = [
  "Update android & iOS app name",
  "Upload app logo for deployment",
  "Update OneSignal Id",
  "Add In-app purchase from the app settings",
];

const DAY_FROM_NOW = 4;
const REMOVE_SUCCESS_LOGS_CRON = "0 0 * * SUN";
const REMOVE_BUNDLES_CRON = "0 0 * * SUN";

export {
  customhostDeploymentDir,
  DAY_FROM_NOW,
  DEPLOYMENT_REQUIREMENTS,
  githubrepo,
  REMOVE_BUNDLES_CRON,
  REMOVE_SUCCESS_LOGS_CRON,
};
