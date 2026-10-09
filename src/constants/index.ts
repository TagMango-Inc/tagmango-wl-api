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
const REMOVE_BUNDLES_CRON = "30 0 * * *"; // daily
const UPDATE_IOS_REVIEW_STATUS_CRON = "0 */3 * * *";
const UPDATE_PRE_REQ_CRON = "0 11,23 * * *";
const UPDATE_ANDROID_PLAY_STORE_STATUS_CRON = "0 */6 * * *"; // Every 6 hours
const CLEANUP_DEPLOYMENT_REQUESTS_CRON = "0 0 * * *"; // Daily at midnight
const DEPLOYMENT_REQUEST_RETENTION_DAYS = 7;
const CLEANUP_DEPLOYMENT_FOLDERS_CRON = "0 * * * *"; // Every hour
const DEPLOYMENT_FOLDER_RETENTION_HOURS = 48;
const AAB_RETENTION_HOURS = 48;
// shared gem folders (one per Ruby version + Gemfile.lock) unused this long are removed
const GEM_CACHE_RETENTION_DAYS = 14;

const DEFAULT_IOS_DEVELOPER_ACCOUNT_ID = "68cbf3128913609eedb102df";

export {
  AAB_RETENTION_HOURS,
  CLEANUP_DEPLOYMENT_FOLDERS_CRON,
  CLEANUP_DEPLOYMENT_REQUESTS_CRON,
  customhostDeploymentDir,
  DAY_FROM_NOW,
  DEFAULT_IOS_DEVELOPER_ACCOUNT_ID,
  DEPLOYMENT_FOLDER_RETENTION_HOURS,
  DEPLOYMENT_REQUEST_RETENTION_DAYS,
  GEM_CACHE_RETENTION_DAYS,
  DEPLOYMENT_REQUIREMENTS,
  githubrepo,
  REMOVE_BUNDLES_CRON,
  REMOVE_SUCCESS_LOGS_CRON,
  UPDATE_ANDROID_PLAY_STORE_STATUS_CRON,
  UPDATE_IOS_REVIEW_STATUS_CRON,
  UPDATE_PRE_REQ_CRON,
};
