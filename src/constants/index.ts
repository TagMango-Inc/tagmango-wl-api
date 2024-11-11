const githubrepo = "TagMangoApp";
const customhostDeploymentDir = "deployments";

const DEPLOYMENT_REQUIREMENTS = [
  "Update android & iOS app name",
  "Upload app logo for deployment",
  "Update OneSignal Id",
  "Add In-app purchase and subscription from the app settings",
];

const DAY_FROM_NOW = 4;
const REMOVE_SUCCESS_LOGS_CRON = "0 0 * * SUN";
const REMOVE_BUNDLES_CRON = "0 0 * * SUN";
const MIGRATE_CRON = "15 21 * * *";
const UPDATE_IOS_REVIEW_STATUS_CRON = "0 */3 * * *";

export {
  customhostDeploymentDir,
  DAY_FROM_NOW,
  DEPLOYMENT_REQUIREMENTS,
  githubrepo,
  MIGRATE_CRON,
  REMOVE_BUNDLES_CRON,
  REMOVE_SUCCESS_LOGS_CRON,
  UPDATE_IOS_REVIEW_STATUS_CRON,
};
