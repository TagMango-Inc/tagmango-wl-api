const githubrepo = "TagMangoApp";
const customhostDeploymentDir = "deployments";

const RECURRING_JOB = "0 0 * * SUN";

const DEPLOYMENT_REQUIREMENTS = [
  "Update android & iOS app name",
  "Upload app logo for deployment",
  "Update OneSignal Id",
  "Add In-app purchase from the app settings",
];

export {
  customhostDeploymentDir,
  DEPLOYMENT_REQUIREMENTS,
  githubrepo,
  RECURRING_JOB,
};
