// const ROOT_BRANCH = "main"; // will be updated to the actual branch name (main)
const githubrepo = "TagMangoApp";
const customhostDeploymentDir = "deployments";

const CURRENT_VERSION_NAME = "3.1.6";
const CURRENT_VERSION_NUMBER = 600;
const ROOT_BRANCH = `v/${CURRENT_VERSION_NAME}`;

const RECURRING_JOB = "0 0 * * SUN";

export {
  CURRENT_VERSION_NAME,
  CURRENT_VERSION_NUMBER,
  RECURRING_JOB,
  ROOT_BRANCH,
  customhostDeploymentDir,
  githubrepo,
};
