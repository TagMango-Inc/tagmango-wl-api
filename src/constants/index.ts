const githubrepo = "TagMangoApp";
const customhostDeploymentDir = "deployments";

/**
 * A deployment's workspace under deployments/: one per app and platform, so an
 * app's iOS and Android deploys can run (and be restarted) independently.
 */
const deploymentFolderName = (bundle: string, platform: "android" | "ios") =>
  `${bundle}-${platform}`;

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
const DEPLOYMENT_FOLDER_RETENTION_HOURS = 24;
const AAB_RETENTION_HOURS = 48;
// shared gem folders (one per Ruby version + Gemfile.lock) unused this long are removed
const GEM_CACHE_RETENTION_DAYS = 14;
// CocoaPods cache entries for local-path pods (hermes-engine etc.) older than
// this are removed; a missing one is downloaded again on the next pod install
const EXTERNAL_POD_CACHE_RETENTION_DAYS = 2;
// Gradle build-cache entries unused this long are removed (Gradle's default
// is 7). Entries shared across apps are used by every build and stay.
const GRADLE_BUILD_CACHE_RETENTION_DAYS = 2;

// "TagMango" (team Z9M2DKF2B7). New apps don't need an App Group any more,
// which is what filled this account up.
const DEFAULT_IOS_DEVELOPER_ACCOUNT_ID = "68cbf2a78913609eedb102de";

export {
  AAB_RETENTION_HOURS,
  CLEANUP_DEPLOYMENT_FOLDERS_CRON,
  CLEANUP_DEPLOYMENT_REQUESTS_CRON,
  customhostDeploymentDir,
  DAY_FROM_NOW,
  deploymentFolderName,
  DEFAULT_IOS_DEVELOPER_ACCOUNT_ID,
  DEPLOYMENT_FOLDER_RETENTION_HOURS,
  DEPLOYMENT_REQUEST_RETENTION_DAYS,
  EXTERNAL_POD_CACHE_RETENTION_DAYS,
  GEM_CACHE_RETENTION_DAYS,
  GRADLE_BUILD_CACHE_RETENTION_DAYS,
  DEPLOYMENT_REQUIREMENTS,
  githubrepo,
  REMOVE_BUNDLES_CRON,
  REMOVE_SUCCESS_LOGS_CRON,
  UPDATE_ANDROID_PLAY_STORE_STATUS_CRON,
  UPDATE_IOS_REVIEW_STATUS_CRON,
  UPDATE_PRE_REQ_CRON,
};
